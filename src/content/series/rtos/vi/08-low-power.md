---
lesson: 8
lang: vi
title: "Tiết kiệm điện — Tickless idle và ngân sách pin"
description: "Vì sao tick 1 kHz phá nát thời lượng pin, tickless idle sửa nó ra sao, phần ngoại vi và clock mà kernel không làm hộ được, và cách đo dòng cho trung thực."
duration: "16 phút"
tags: ["FreeRTOS", "Tiết kiệm điện", "Tickless"]
---

## Vấn đề do cái tick gây ra

Một bản FreeRTOS mặc định nhận ngắt timer 1.000 lần mỗi giây. Mỗi lần như thế đánh thức CPU
khỏi giấc ngủ, chạy trình xử lý tick, kết luận chẳng có việc gì, rồi ngủ lại. Trên STM32L4,
con số xấp xỉ là:

- 1.000 × (thời gian tỉnh dậy + khoảng 3 µs chạy tick handler)
- dòng trung bình khoảng **1 mA**, so với sàn **1,2 µA** của chế độ stop

Một viên CR2032 chứa khoảng 220 mAh. Ở 1 mA là chín ngày. Ở 10 µA là hai năm rưỡi. **Cái tick
chính là toàn bộ khác biệt**, và bạn có tối ưu code ứng dụng cỡ nào cũng không chạm tới nó.

![Tickless idle](/MyPortfolio/images/rtos/tickless-idle.svg)

## Tickless idle

Ý tưởng: khi task idle sắp chạy và chẳng có gì cần xử lý trong N tick tới, hãy **dừng hẳn cái
tick**, cho CPU ngủ sâu, và lập trình một timer tiêu thụ thấp để tỉnh sau đúng N tick. Lúc
tỉnh, báo cho kernel biết thực tế đã trôi qua bao lâu.

Bật nó lên:

```c
/* FreeRTOSConfig.h */
#define configUSE_TICKLESS_IDLE                 1
#define configEXPECTED_IDLE_TIME_BEFORE_SLEEP   5   /* chỉ ngủ nếu rảnh ≥5 tick */
```

Với `configUSE_TICKLESS_IDLE 1` bạn nhận bản hiện thực chung, dùng SysTick và cho bạn `WFI`
(ngủ, clock vẫn chạy). Đó đã là một cải thiện lớn. Còn để vào **chế độ stop**, nơi chính
SysTick cũng tắt, bạn phải tự viết — `configUSE_TICKLESS_IDLE 2` cộng một macro
`portSUPPRESS_TICKS_AND_SLEEP()`.

### Viết nó cho STM32L4

```c
/* FreeRTOSConfig.h */
#define configUSE_TICKLESS_IDLE   2
#define portSUPPRESS_TICKS_AND_SLEEP(x)  vApplicationSleep(x)
```

```c
void vApplicationSleep(TickType_t xExpectedIdleTime)
{
    /* 1. Kẹp lại theo mức mà timer đánh thức đếm được thật */
    uint32_t sleep_ms = xExpectedIdleTime * portTICK_PERIOD_MS;
    if (sleep_ms > MAX_LPTIM_MS) sleep_ms = MAX_LPTIM_MS;

    /* 2. Dừng tick để nó không nổ trong lúc ta đang quyết định */
    portSUPPRESS_TICKS_AND_SLEEP_ENTER();

    /* 3. Cơ hội cuối để huỷ — kernel kiểm tra xem có ISR nào vừa làm một task
     *    sẵn sàng trong khoảng giữa lúc quyết định idle và lúc này không. */
    eSleepModeStatus status = eTaskConfirmSleepModeStatus();

    if (status == eAbortSleep) {
        /* có thứ vừa sẵn sàng — đừng ngủ, chỉ cần khởi động lại tick */
        restart_systick();
    } else {
        uint32_t before = lptim_get_count();

        lptim_set_wakeup(sleep_ms);
        if (status != eNoTasksWaitingTimeout) {
            /* có task đang chờ timeout; phải tỉnh đúng lúc cho nó */
        }

        suspend_unneeded_peripherals();
        HAL_PWR_EnterSTOPMode(PWR_LOWPOWERREGULATOR_ON, PWR_STOPENTRY_WFI);
        /* ---- chương trình chạy tiếp từ đây sau ngắt đánh thức ---- */
        SystemClock_Config();               /* PLL đã bị dừng — phục hồi lại */
        resume_peripherals();

        uint32_t slept_ms = lptim_elapsed_ms(before);

        /* 4. Báo cho kernel biết thực tế đã trôi qua bao lâu */
        vTaskStepTick(pdMS_TO_TICKS(slept_ms));
        restart_systick();
    }

    portSUPPRESS_TICKS_AND_SLEEP_EXIT();
}
```

Bốn điều quyết định thành hay bại:

1. **`eTaskConfirmSleepModeStatus()` không phải tuỳ chọn.** Có một khoảng trống giữa lúc kernel
   quyết định vào idle và lúc code của bạn dừng clock. Một ISR nổ trong khoảng đó sẽ làm một
   task sẵn sàng, và nếu bạn vẫn ngủ thì bạn vừa thêm một độ trễ không giới hạn. Hàm này cho
   bạn biết điều đó.
2. **`vTaskStepTick()` phải khớp với thực tế.** Nếu bạn ngủ 500 ms mà báo cho kernel 400, thì
   mọi timeout trong hệ thống đã sai, và sai thêm sau mỗi lần ngủ.
3. **Cây clock dừng lại trong chế độ stop.** PLL tắt khi tỉnh; không gọi `SystemClock_Config()`
   là bạn đang chạy bằng bộ RC nội ở một phần nhỏ tốc độ cũ, và mọi tốc độ baud cùng mọi phép
   tính định thời đều sai. Điều này sinh ra hiện tượng kinh điển "chạy được nhưng UART thành
   rác sau lần ngủ đầu tiên".
4. **Đọc thời gian đã trôi qua từ một đồng hồ vẫn chạy** — RTC hoặc LPTIM, chứ không phải
   SysTick, vì nó đã bị dừng.

## Phần kernel không làm hộ bạn được

Tickless idle lo phần CPU. Phần còn lại của bo mạch là việc của bạn, và trên phần lớn thiết kế
thì chính ngoại vi mới chiếm phần lớn:

| Thứ tiêu thụ | Dòng điển hình | Cách xử lý |
| --- | --- | --- |
| CPU ở chế độ stop | 1–10 µA | tickless idle |
| Chân GPIO để trôi nổi | **10–100 µA mỗi chân** | đặt mọi chân không dùng thành analog hoặc kéo lên/xuống |
| Clock ngoại vi để bật | 50–500 µA | tắt trong hook trước khi ngủ, bật lại khi tỉnh |
| ADC / bộ so sánh | 200 µA–2 mA | tắt nguồn một cách tường minh |
| Cảm biến ở chế độ liên tục | 100 µA–5 mA | dùng chế độ one-shot, hoặc lệnh sleep của nó |
| Để một con LED sáng | **2–20 mA** | nó áp đảo mọi thứ khác |
| Điện trở treo trên bus I²C | 200 µA mỗi con ở 3,3 V/10 kΩ | cắt nguồn bus, hoặc dùng điện trở lớn hơn |

Chân đầu vào để trôi nổi là thứ hay bẫy người ta: một chân CMOS không được điều khiển sẽ dao
động quanh ngưỡng chuyển mạch và đốt dòng liên tục. Trên một chip 64 chân với hai chục chân
không dùng, chỉ riêng nó đã có thể là một mili-ampe. Trong CubeMX, hãy đặt mọi chân không dùng
thành *Analog* — đó là trạng thái rò rỉ ít nhất.

## Cấu trúc ứng dụng cho tiết kiệm điện

Những thói quen RTOS ở bài 3 hoá ra chính là những thói quen đúng:

```c
/* TỐT — chặn lại, nên task idle được chạy và CPU ngủ được */
static void sensor_task(void *arg)
{
    TickType_t last = xTaskGetTickCount();
    for (;;) {
        sensor_wake();
        sample_and_send();
        sensor_sleep();
        vTaskDelayUntil(&last, pdMS_TO_TICKS(60000));   /* 60 s giữa hai lần lấy mẫu */
    }
}
```

```c
/* TỆ — hỏi vòng, nên task idle không bao giờ chạy và chẳng có gì ngủ được */
static void sensor_task(void *arg)
{
    for (;;) {
        if (timer_elapsed()) { sample_and_send(); }
        taskYIELD();
    }
}
```

**Bất kỳ task nào hỏi vòng cũng ngăn mọi giấc ngủ của cả hệ thống.** Một vòng `taskYIELD()` ở
đâu đó lấy đi trọn ngân sách năng lượng của bạn, và nó vô hình trên bàn thử vì mọi thứ vẫn chạy
bình thường.

Các quy tắc thiết kế suy ra từ đó:

- **Mọi task đều chặn trên một thứ gì đó.** Một queue, một notification, hoặc một delay. Không
  bao giờ là một cái cờ.
- **Lấy mẫu thưa nhất mức đặc tả cho phép.** Từ 1 Hz xuống 0,1 Hz là tiết kiệm 10 lần, không
  tối ưu code nào sánh được.
- **Gom lưu lượng radio thành cụm.** Một lần phát BLE hay LoRa tốn 10–100 mA trong vài
  mili-giây. Mười số đọc trong một gói tin tốn bằng một phần mười của mười gói tin.
- **Căn các lần thức trùng nhau.** Ba task thức ở 1 s, 2 s và 5 s nghĩa là thức ở 1,2,3,4,5,6…
  Đổi thành 1 s, 2 s và 4 s thì số lần thức riêng biệt ít hơn nhiều, vì chúng trùng nhau.

Điểm cuối tinh tế và đáng giá hơn vẻ ngoài: chi phí cố định của một lần thức (khởi động lại
clock, ổn định bộ điều áp) thường lớn hơn cả phần việc làm được, nên **thức ít lần nhưng mỗi
lần lâu hơn vẫn hơn thức nhiều lần ngắn ngủi.**

## Idle hook và tick hook

Hai hook hữu ích ngay cả trước khi bạn làm tickless đầy đủ:

```c
#define configUSE_IDLE_HOOK 1

void vApplicationIdleHook(void)
{
    /* Chạy mỗi khi task idle chạy. Cách tiết kiệm điện đơn giản nhất có thể:
     * ngủ tới ngắt kế tiếp. Clock vẫn bật nên không cần cấu hình lại gì —
     * thêm dòng này vào một dự án đang chạy là an toàn, ngay hôm nay. */
    __WFI();
}
```

Chỉ một dòng đó thường giảm 50–70% dòng trung bình trên hệ thống vốn đang quay vòng bận trong
idle, và nó không thể làm hỏng gì cả, vì tick kế tiếp sẽ đánh thức bạn.

```c
#define configUSE_TICK_HOOK 1

void vApplicationTickHook(void)
{
    /* Chạy trong ISR của tick — chỉ nên vài lệnh.
     * Hữu ích cho một bộ đếm uptime rẻ tiền hoặc để "cho ăn" watchdog phần cứng. */
    tick_counter++;
}
```

## Đo dòng cho trung thực

Bạn không tối ưu được thứ chưa đo, và ở đây thì đồng hồ vạn năng sẽ nói dối bạn. Nó lấy trung
bình, và thường không phân giải nổi một xung 2 mA dài 500 µs trên nền sàn 5 µA.

Thứ thực sự dùng được:

- **Máy đo dòng có ghi dữ liệu** — Nordic PPK2 (~100 USD), Otii Arc, hoặc Joulescope. PPK2 là
  lựa chọn thực dụng: phân giải micro-ampe, và nó vẽ dòng theo thời gian nên bạn *thấy* được
  từng lần thức.
- **Một điện trở shunt và máy hiện sóng** — mắc 1 Ω nối tiếp, đo điện áp trên nó. Thô sơ nhưng
  miễn phí, và đủ để thấy hình dáng.
- **Một chân GPIO làm dấu** — kéo chân lên trong lúc đang thức. Đối chiếu vết đó với vết dòng
  điện cho bạn biết chính xác lần thức nào tốn bao nhiêu.

Cần nhìn gì, theo thứ tự:

1. **Cái sàn.** Khi mọi thứ đang rảnh, mức nền là bao nhiêu? Nếu nó là 500 µA thay vì 10 µA thì
   bạn có vấn đề ở ngoại vi hoặc ở chân, không phải ở firmware.
2. **Tần suất thức.** Mỗi giây bao nhiêu xung? Nếu là 1.000 thì tickless chưa hoạt động.
3. **Độ dài mỗi lần thức.** Mỗi xung dài bao nhiêu? Nếu dài hơn hẳn phần việc thật thì việc
   khởi động lại clock đang chiếm phần lớn, và bạn nên gom cụm.
4. **Các đỉnh.** Có gì tiêu thụ nhiều hơn dự kiến không? Một con radio, đèn nền màn hình, hay
   dòng nạp vào một tụ.

Rồi tính con số trung thực:

```
trung_bình = (I_thức × t_thức + I_ngủ × t_ngủ) / (t_thức + t_ngủ)
số_giờ_dùng = mAh_của_pin / trung_bình_mA
```

Một chu kỳ 60 giây, trong đó bạn thức 20 ms ở 8 mA và ngủ phần còn lại ở 6 µA:

```
trung_bình = (8 × 0,020 + 0,006 × 59,98) / 60 = (0,16 + 0,36) / 60 ≈ 8,7 µA
220 mAh / 0,0087 mA ≈ 25.000 giờ ≈ 2,9 năm
```

Hãy để ý điều phép tính đó hé lộ: dòng lúc ngủ, với 0,36, giờ đã *lớn hơn* phần đóng góp của
lúc thức là 0,16. Khi tickless idle đã chạy tốt, mức cải thiện tiếp theo đến từ cái sàn, không
phải từ việc làm code nhanh hơn.

## Những kiểu hỏng thường gặp

- **Tickless chẳng có tác dụng gì.** Có thứ gì đó đang hỏi vòng. Hãy xem
  `vTaskGetRunTimeStats` — nếu task idle không nhận được 95% CPU trở lên, hãy tìm xem ai giữ.
- **UART thành rác sau lần ngủ đầu.** PLL chưa được phục hồi. Xem điểm 3 ở trên.
- **Timeout trôi dần.** `vTaskStepTick()` đang được đưa số sai, hoặc bạn đang đo thời gian trôi
  qua bằng một đồng hồ cũng đã bị dừng.
- **Thiết bị không bao giờ tỉnh.** Nguồn đánh thức chưa được bật trước khi vào stop, hoặc nó
  nằm trên miền clock cũng vừa bị tắt.
- **Dòng ổn trên board phát triển, tệ trên sản phẩm.** Board phát triển có bộ điều áp, đèn LED
  và một con chip debug mà bạn cũng đang cấp nguồn. Hãy đo riêng đường nguồn của MCU.

## Tự kiểm tra

1. Vì sao tick 1 kHz chiếm phần lớn ngân sách năng lượng của thiết bị chạy pin?
2. `eTaskConfirmSleepModeStatus()` phòng ngừa điều gì?
3. Vì sao phải gọi `SystemClock_Config()` sau chế độ stop?
4. Một task gọi `taskYIELD()` trong vòng lặp. Thời lượng pin của bạn ra sao, và vì sao điều đó
   vô hình khi kiểm thử chức năng?

## Bài tiếp theo

Bài 9: hai nhân. FreeRTOS SMP, ghim task vào nhân, vì sao `taskENTER_CRITICAL` không còn đủ, và
FreeRTOS so với Zephyr cùng ThreadX thế nào khi bạn phải chọn.
