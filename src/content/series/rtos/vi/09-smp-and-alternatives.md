---
lesson: 9
lang: vi
title: "Hai nhân, và chọn kernel nào"
description: "FreeRTOS SMP: ghim task vào nhân, vì sao taskENTER_CRITICAL không còn đủ, và spinlock. Rồi so sánh thẳng thắn với Zephyr, ThreadX và CMSIS-RTOS2."
duration: "15 phút"
tags: ["FreeRTOS", "SMP", "Zephyr"]
---

## Có nhân thứ hai thì khác gì

MCU đa nhân giờ là chuyện thường: ESP32 có hai nhân Xtensa, RP2040 có hai Cortex-M0+, STM32H7
dual-core có một M7 và một M4. FreeRTOS chính thức hỗ trợ SMP từ bản v11.

Thay đổi không phải là "CPU nhân đôi". Mà là **hai task giờ chạy đúng nghĩa cùng một khoảnh
khắc**, và mọi giả định dựa trên "chỉ một thứ chạy tại một thời điểm" đều cần kiểm tra lại.

![FreeRTOS SMP](/MyPortfolio/images/rtos/smp.svg)

Ba giả định cụ thể bị phá vỡ:

**1. Ưu tiên không còn tuyệt đối trên toàn hệ thống.** Trên một nhân, task ưu tiên cao nhất ở
Ready luôn đang chạy. Với hai nhân, *hai* task ưu tiên cao nhất đang chạy. Một task ưu tiên 3
có thể đang thực thi trong lúc task ưu tiên 5 cũng đang thực thi — ở nhân bên kia. "Ưu tiên cao
hơn thì chạy trước" trở thành "ưu tiên cao hơn thì được cấp nhân sớm hơn".

**2. `taskENTER_CRITICAL()` chỉ dừng nhân hiện tại.** Nó tắt ngắt và scheduler một cách *cục
bộ*. Nhân kia vẫn chạy, và có thể bước thẳng vào đúng dữ liệu bạn tưởng đã bảo vệ. Đây là khác
biệt nguy hiểm nhất, vì code trông vẫn đúng và phần lớn thời gian vẫn chạy tốt.

**3. Cache và thứ tự truy cập bộ nhớ trở nên quan trọng.** Trên chip có cache riêng cho từng
nhân, một phép ghi của nhân 0 có thể chưa thấy được ở nhân 1 cho tới khi có một thao tác cache.
`volatile` không giúp gì; bạn cần cơ chế của kernel hoặc rào chắn (barrier) tường minh.

## Ghim task vào nhân (affinity)

Cách an toàn để bước vào SMP là ghim phần lớn task vào một nhân, nhờ đó lấy lại được cách suy
luận kiểu một nhân bên trong từng nhân:

```c
/* ESP-IDF / FreeRTOS SMP */
xTaskCreatePinnedToCore(wifi_task,   "wifi",   4096, NULL, 5, NULL, 0);  /* nhân 0 */
xTaskCreatePinnedToCore(control_task,"control", 2048, NULL, 6, NULL, 1);  /* nhân 1 */
xTaskCreatePinnedToCore(app_task,    "app",    4096, NULL, 4, NULL, tskNO_AFFINITY);
```

Hoặc với FreeRTOS SMP gốc:

```c
TaskHandle_t h;
xTaskCreate(control_task, "control", 2048, NULL, 6, &h);
vTaskCoreAffinitySet(h, (1u << 1));      /* mặt nạ bit: chỉ nhân 1 */
```

Khuôn mẫu hiệu quả trong thực tế, cũng là điều ESP-IDF làm theo mặc định:

- **Nhân 0: kết nối.** WiFi, BLE, ngăn xếp TCP/IP. Chúng có yêu cầu định thời riêng và hãng đã
  ghim chúng ở đây rồi.
- **Nhân 1: ứng dụng của bạn.** Vòng điều khiển, lấy mẫu cảm biến, mọi thứ có deadline bạn quan
  tâm.
- **Không ghim: chỉ dành cho task không dùng chung dữ liệu và không có yêu cầu định thời.** Ví
  dụ như ghi log.

Ghim một task nhạy deadline không phải chữa cháy, đó là thiết kế tốt: nó làm cho việc phân tích
định thời khả thi trở lại. Trường hợp xấu nhất của một task không ghim phụ thuộc vào chuyện đang
xảy ra trên cả hai nhân.

## Khoá cho đúng

Vì `taskENTER_CRITICAL()` không còn đủ, các port SMP cung cấp một **spinlock** phối hợp giữa các
nhân:

```c
/* ESP-IDF */
static portMUX_TYPE my_lock = portMUX_INITIALIZER_UNLOCKED;

void update_shared(void)
{
    portENTER_CRITICAL(&my_lock);      /* chặn cả nhân bên kia */
    shared.a = 1;
    shared.b = 2;
    portEXIT_CRITICAL(&my_lock);
}

/* từ trong ISR */
portENTER_CRITICAL_ISR(&my_lock);
/* ... */
portEXIT_CRITICAL_ISR(&my_lock);
```

Spinlock **chờ bận**. Nhân kia quay vòng, đốt chu kỳ, cho tới khi bạn nhả ra. Nên quy tắc ở bài
4 trở nên khắt khe hơn: đoạn găng vốn là "hãy giữ ngắn" trên một nhân thì thành "hãy giữ chỉ vài
lệnh" trên hai nhân, vì giờ bạn đang lãng phí thời gian của một nhân khác, không chỉ làm trễ nó.

Những gì vẫn an toàn mà không cần thêm gì:

- **Queue, semaphore, mutex, event group, stream buffer.** Kernel hiện thực chúng với cơ chế
  khoá liên nhân đúng đắn ở bên trong. Đây là lý lẽ mạnh nhất cho kỷ luật truyền thông điệp ở
  bài 3: **nó chuyển sang SMP mà không cần sửa gì.**
- **Thao tác nguyên tử** trên một từ đơn lẻ đã căn thẳng, ở nơi kiến trúc bảo đảm điều đó.

Những gì không an toàn:

- Bất cứ thứ gì chỉ được canh bằng `taskENTER_CRITICAL()`.
- `volatile` trên một cấu trúc nhiều từ.
- Giả định có thứ tự theo ưu tiên giữa các task ở hai nhân khác nhau.

## Giao tiếp giữa các nhân

Hai nhân cần nói chuyện, và cơ chế phụ thuộc vào mức độ gắn kết của chúng.

**Đối xứng (SMP), RAM dùng chung** — ESP32, RP2040. Một kernel, một tập queue; cứ dùng queue
đúng như trên một nhân. Kernel lo phần còn lại.

**Bất đối xứng (AMP), hai kernel riêng** — STM32H7 với một M7 và một M4 chạy firmware khác
nhau. Ở đây bạn cần một cơ chế IPC thật:

- **Mailbox / HSEM phần cứng** — một ngoại vi semaphore mà cả hai nhân đều thấy.
- **Bộ nhớ dùng chung + OpenAMP / RPMsg** — framework chuẩn, và là thứ các ví dụ của ST dùng.
- **Một ring buffer trong bộ nhớ dùng chung** kèm bảo trì cache tường minh:

```c
/* nhân ghi, sau khi đổ dữ liệu vào buffer */
SCB_CleanDCache_by_Addr((uint32_t *)buf, len);   /* đẩy ra khỏi cache của tôi */
notify_other_core();

/* nhân đọc, trước khi đọc */
SCB_InvalidateDCache_by_Addr((uint32_t *)buf, len);  /* bỏ bản cũ trong cache */
```

Quên những thao tác cache đó sinh ra lỗi AMP kinh điển: dữ liệu đúng trong bộ nhớ nhưng sai khi
đọc ra, một cách chập chờn, tuỳ áp lực cache. Nếu bạn chỉ nhớ một điều từ mục này, thì đó là:
trên hệ AMP có cache, **mọi buffer dùng chung đều cần clean và invalidate tường minh**, và tốt
nhất là cấu hình vùng đó thành non-cacheable trong MPU ngay từ đầu.

## Chọn kernel

FreeRTOS không phải lúc nào cũng là câu trả lời đúng. So sánh thẳng thắn:

| | FreeRTOS | Zephyr | ThreadX | RT-Thread |
| --- | --- | --- | --- | --- |
| Giấy phép | MIT | Apache 2.0 | MIT | Apache 2.0 |
| Đơn vị bảo trợ | AWS | Linux Foundation | Microsoft/Eclipse | cộng đồng, mạnh ở TQ |
| Dung lượng | 6–12 kB | 8–50 kB+ | 2–20 kB | 4–20 kB |
| Độ dốc học tập | **thấp** | cao | trung bình | trung bình |
| Kèm driver | không | **có, rất nhiều** | một số | có |
| Hệ thống build | của bạn | west + CMake + Kconfig | của bạn | scons/CMake |
| Device tree | không | **có** | không | không |
| Mạng | riêng (lwIP) | **tích hợp sẵn** | NetX | tích hợp sẵn |
| Chứng nhận an toàn | SafeRTOS (trả phí) | có | **đã chứng nhận trước** | hạn chế |
| Hãng chip hỗ trợ | khắp nơi | rất rộng | rộng | chủ yếu hãng TQ |

Hướng dẫn thực dụng:

**Chọn FreeRTOS khi** bạn chỉ cần một scheduler và không cần gì khác, BSP của hãng đã kèm nó
sẵn, hoặc đội đang trong giai đoạn học. Nó là một kernel, không phải một nền tảng, và đó chính là
điểm mạnh — bạn đọc hết được nó.

**Chọn Zephyr khi** bạn cần driver, mạng, Bluetooth, hệ thống file và quản lý năng lượng như một
khối gắn kết, và bạn đang xây một dòng sản phẩm. Nó nhiều hơn một kernel rất nhiều: device tree
để mô tả phần cứng, Kconfig để chọn tính năng, một thư viện driver khổng lồ. Cái giá là độ dốc
học tập thật sự dựng: hãy tính bằng tuần chứ không phải bằng buổi chiều.

**Chọn ThreadX khi** bạn cần bộ hồ sơ an toàn đã được chứng nhận trước (IEC 61508 SIL 4,
ISO 26262 ASIL D) mà không phải tự xây bộ chứng cứ. Giờ đã mã nguồn mở dưới Eclipse. Dung lượng
của nó nhỏ nhất trong bốn cái.

**Chọn RT-Thread khi** bạn làm với các hãng silicon Trung Quốc, nơi hỗ trợ BSP mạnh nhất.

Phần khái niệm trùng nhau rất lớn: mọi thứ ở bài 1 tới bài 8 đều chuyển được. `k_msgq` của Zephyr
là một queue, `k_mutex` có kế thừa ưu tiên, `k_sem` là semaphore, và tickless idle của nó chạy
theo cùng nguyên lý. Học chắc một kernel thì cái thứ hai chỉ mất vài ngày, không phải vài tháng.

## CMSIS-RTOS2 — lớp bọc để khả chuyển

API bọc chuẩn của ARM, nằm trên FreeRTOS, RTX hoặc ThreadX:

```c
#include "cmsis_os2.h"

static void my_thread(void *arg) { for (;;) { osDelay(100); } }

int main(void)
{
    osKernelInitialize();

    const osThreadAttr_t attr = {
        .name = "sensor",
        .stack_size = 1024,               /* LƯU Ý: tính bằng BYTE, không phải từ */
        .priority = osPriorityAboveNormal,
    };
    osThreadNew(my_thread, NULL, &attr);

    osKernelStart();
}
```

Đây là thứ STM32CubeMX sinh ra khi bạn bật FreeRTOS, nên bạn sẽ gặp nó dù có chọn hay không.

**Điểm lợi:** code ứng dụng giống hệt nhau qua các kernel, và đó là con đường được ghi trong tài
liệu của ST.

**Những điểm bất lợi**, mà theo kinh nghiệm của tôi thì đáng cân nhắc hơn điểm lợi:

- **Nó chỉ phơi ra phần chung.** Không có stream buffer, không có giá trị trả về của
  `xTaskDelayUntil`, API notification bị thu gọn.
- **Thông tin lỗi bị mất.** Chỗ FreeRTOS phân biệt "queue đầy" với "handle không hợp lệ" thì
  CMSIS thường chỉ trả về một `osError` chung chung.
- **Gỡ lỗi phải xuyên qua hai lớp.** Vết stack đi qua lớp bọc, còn tài liệu bạn tìm được trên
  mạng lại nói về lớp bên dưới.
- **Đơn vị khác nhau.** `stack_size` ở đây là byte, còn FreeRTOS là từ. Chênh nhau bốn lần một
  cách âm thầm.

Khuyến nghị của tôi: nếu CubeMX đã sinh ra nó và bạn không định port đi đâu, cứ giữ — chống lại
bộ sinh code không đáng. Còn nếu viết từ đầu, hãy dùng API gốc. Tính khả chuyển thật giữa các
kernel bị giới hạn bởi driver và hệ thống build nhiều hơn hẳn so với bởi API của scheduler.

## Tự kiểm tra

1. Vì sao `taskENTER_CRITICAL()` không đủ trên hệ SMP?
2. Ghim một task nhạy deadline vào một nhân đem lại điều gì?
3. Những cơ chế FreeRTOS nào an toàn xuyên nhân mà không cần làm gì thêm, và vì sao điều đó
   khẳng định kỷ luật truyền thông điệp?
4. Khi nào bạn chọn Zephyr thay vì FreeRTOS, và đánh đổi những gì?

## Bài tiếp theo

Bài cuối: một thiết bị hoàn chỉnh, thiết kế từ yêu cầu đi xuống — phân rã task, gán ưu tiên,
ngân sách CPU và RAM tính ra bằng số, cùng bộ chẩn đoán đi kèm sản phẩm.
