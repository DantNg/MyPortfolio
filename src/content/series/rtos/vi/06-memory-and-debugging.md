---
lesson: 6
lang: vi
title: "Bộ nhớ, stack và gỡ lỗi thứ bạn không nhìn thấy"
description: "Các sơ đồ heap, tính stack bằng bằng chứng thay vì mê tín, bắt lỗi tràn trước khi nó phá hỏng task khác, và bộ chẩn đoán đáng để lại trong sản phẩm."
duration: "16 phút"
tags: ["RTOS", "Bộ nhớ", "Gỡ lỗi"]
---

## RAM đi đâu mất

![Bố cục bộ nhớ RTOS](/MyPortfolio/images/rtos/stack-memory.svg)

Đưa RTOS vào làm thay đổi bức tranh bộ nhớ theo cách khiến người ta bất ngờ ngay lần đầu:

| Thứ tiêu tốn | Chi phí điển hình |
| --- | --- |
| Dữ liệu kernel (danh sách ready, tick, TCB hiện tại) | ~200 byte |
| Mỗi task: TCB | ~90 byte |
| Mỗi task: stack | 256 B – 2 kB — **khoản lớn nhất** |
| Mỗi queue | `độ_dài × kích_thước_phần_tử` + ~80 byte |
| Mỗi mutex/semaphore | ~80 byte |
| Task dịch vụ timer | stack riêng, ~512 B |
| Task idle | stack riêng, `configMINIMAL_STACK_SIZE` |

Tám task, mỗi task 512 byte, là 4 kB stack trước khi bạn viết một dòng code ứng dụng. Trên
con chip 20 kB RAM, đó là một phần năm ngân sách, và đó là lý do câu hỏi "nên có bao nhiêu
task?" có câu trả lời thật: **càng ít càng tốt, đúng mức thiết kế thật sự cần.**

## Các sơ đồ heap

FreeRTOS kèm năm bộ cấp phát; bạn chọn bằng cách biên dịch đúng một file `heap_n.c`.

| | Làm gì | Dùng khi |
| --- | --- | --- |
| `heap_1` | chỉ cấp phát, không bao giờ giải phóng | tạo mọi thứ lúc khởi động và không bao giờ xoá — **an toàn nhất** |
| `heap_2` | cấp phát/giải phóng, không gộp khối | di sản cũ; đừng chọn cho dự án mới |
| `heap_3` | bọc `malloc`/`free` kèm khoá | đã có sẵn heap của libc và muốn dùng chung một bể |
| `heap_4` | cấp phát/giải phóng **có gộp khối** | mặc định hợp lý |
| `heap_5` | như heap_4 nhưng trên nhiều vùng nhớ rời rạc | có RAM nội + SDRAM ngoài |

Khuyến nghị thẳng thắn:

- **`heap_1` nếu được.** Nếu mọi task, queue và semaphore đều được tạo trước
  `vTaskStartScheduler()` và không bao giờ bị xoá, `heap_1` xoá bỏ khái niệm phân mảnh. Rất
  nhiều sản phẩm đang bán chạy theo cách này.
- **`heap_4` cho các trường hợp còn lại.** Nó gộp các khối trống liền kề, nên chu kỳ
  cấp phát/giải phóng kéo dài không băm nát heap.
- **Cấp phát tĩnh cho mọi thứ liên quan an toàn.** Với `configSUPPORT_DYNAMIC_ALLOCATION 0`
  và `configSUPPORT_STATIC_ALLOCATION 1`, cả lớp lỗi cấp phát biến mất — trình liên kết báo
  ngay lúc build nếu không vừa. Đây là chuẩn mực trong firmware ô tô và y tế.

Đặt kích thước heap trong `FreeRTOSConfig.h` rồi đo nó:

```c
#define configTOTAL_HEAP_SIZE  ((size_t)(16 * 1024))

/* sau khi khởi động */
printf("heap con trong: %u, thap nhat tung co: %u\n",
       (unsigned)xPortGetFreeHeapSize(),
       (unsigned)xPortGetMinimumEverFreeHeapSize());
```

`xPortGetMinimumEverFreeHeapSize()` mới là con số quan trọng. Nếu nó là 200 byte, bạn chỉ
cách một lần `xTaskCreate` thất bại trong im lặng đúng một tính năng nữa.

Và hãy cài hook để lỗi kêu to lên:

```c
#define configUSE_MALLOC_FAILED_HOOK 1

void vApplicationMallocFailedHook(void)
{
    taskDISABLE_INTERRUPTS();
    /* bật một con LED, ghi vào vùng RAM dự trữ, rồi dừng */
    for (;;) { }
}
```

## Tính stack bằng bằng chứng

Tham số stack của `xTaskCreate` tính **bằng từ, không phải byte**. Trên MCU 32-bit, `128`
nghĩa là 512 byte. Nhầm chỗ này gấp bốn lần là lỗi phổ biến nhất của tuần đầu tiên.

Đoán thì không ăn thua, mà chép số từ ví dụ cũng vậy. Hãy dùng high-water mark:

```c
/* gọi từ bên trong task, hoặc gọi kèm handle của nó */
UBaseType_t words_remaining = uxTaskGetStackHighWaterMark(NULL);

printf("%s: %u tu (%u byte) chua bao gio dung toi\n",
       pcTaskGetName(NULL),
       (unsigned)words_remaining,
       (unsigned)(words_remaining * sizeof(StackType_t)));
```

Nó báo **mức trống ít nhất mà stack từng có**, vì FreeRTOS đổ một mẫu bit đã biết vào stack
lúc tạo task rồi đếm xem còn bao nhiêu chưa bị chạm tới.

Quy trình:

1. Bắt đầu rộng rãi — 1024 từ (4 kB) cho thứ gì có định dạng chuỗi, 256 cho vòng lặp đơn
   giản.
2. Chạy **tình huống xấu nhất**: đường gọi hàm sâu nhất, nhánh xử lý lỗi, bật hết tính năng,
   `printf` dài nhất. Lỗi rất thích những nhánh bạn chưa chạy qua.
3. Đọc high-water mark.
4. Đặt stack bằng `(mức đã dùng + 30%)`, làm tròn lên.

Thứ ăn stack, xếp gần đúng theo mức độ:

- **`printf` / `sprintf`** — 200 tới hơn 1000 byte tuỳ libc. Riêng nó quyết định kích thước
  stack của nhiều task.
- **Mảng cục bộ lớn.** `uint8_t buf[512]` là nửa kilobyte stack. Hãy để `static` nếu chỉ một
  task dùng.
- **Số thực trên chip không có FPU** — các hàm float bằng phần mềm rất ngốn stack.
- **Chuỗi gọi sâu qua HAL của hãng.**
- **Đệ quy.** Trong firmware thì đơn giản là đừng.

## Bắt lỗi tràn stack

Tràn stack không sập gọn gàng. Nó ghi vượt qua cuối stack của một task sang bất cứ thứ gì
nằm kế bên — thường là stack hoặc TCB của task khác — và sự cố hiện ra ở chỗ hoàn toàn khác,
vài phút sau. Đây là lớp lỗi tệ nhất khi làm với RTOS.

Bật cơ chế phát hiện:

```c
#define configCHECK_FOR_STACK_OVERFLOW  2      /* 1 = kiểm con trỏ, 2 = kiểm mẫu bit */

void vApplicationStackOverflowHook(TaskHandle_t xTask, char *pcTaskName)
{
    taskDISABLE_INTERRUPTS();
    /* pcTaskName cho biết chính xác task nào — hãy lưu lại vào chỗ bền vững */
    strncpy(crash_info.task, pcTaskName, sizeof(crash_info.task) - 1);
    crash_info.reason = CRASH_STACK_OVERFLOW;
    NVIC_SystemReset();
}
```

Chế độ 2 kiểm tra một mẫu bit đã biết ở 20 byte cuối stack tại mỗi lần chuyển ngữ cảnh. Nó
tốn vài chu kỳ mỗi lần chuyển và bắt được gần như mọi trường hợp. **Hãy bật khi phát triển,
và cân nhắc nghiêm túc việc bật cả trong sản phẩm** — một cú reset có kiểm soát kèm tên task
được ghi lại vẫn hơn là hành vi hỏng loạn.

Ngoài ra hãy bật cả stack guard dựa trên MPU nếu chip có và port hỗ trợ. Trên Cortex-M có
MPU, tràn stack trở thành một lỗi MemManage ngay tại đúng lệnh gây ra nó.

## Bộ chẩn đoán đáng để lại trong sản phẩm

Hãy viết một hàm và gọi nó từ một lệnh debug hoặc một timer định kỳ:

```c
void system_report(void)
{
    static char buf[640];

    printf("--- tasks ---\n");
    vTaskList(buf);                    /* tên, trạng thái, ưu tiên, stack HWM, id */
    printf("%s", buf);

    printf("--- cpu ---\n");
    vTaskGetRunTimeStats(buf);         /* thời gian chạy tuyệt đối và %% theo task */
    printf("%s", buf);

    printf("heap: trong %u, thap nhat %u\n",
           (unsigned)xPortGetFreeHeapSize(),
           (unsigned)xPortGetMinimumEverFreeHeapSize());

    printf("queue: sample=%u/%u  log=%u/%u\n",
           (unsigned)uxQueueMessagesWaiting(sample_q), 10u,
           (unsigned)uxQueueMessagesWaiting(log_q), 32u);

    printf("qua han: control=%lu  mat mau=%lu\n",
           control_overruns, dropped_samples);
}
```

Hai dòng cuối mới là thứ bắt được vấn đề thật. Một vòng điều khiển quá hạn bốn lần trong tám
tiếng là phát hiện có giá trị mà bạn sẽ không bao giờ thấy bằng cách khác.

Thống kê thời gian chạy cần một bộ đếm độ phân giải cao, thường là một timer phần cứng rảnh
chạy nhanh gấp 10–20 lần tần số tick:

```c
#define configGENERATE_RUN_TIME_STATS            1
#define portCONFIGURE_TIMER_FOR_RUN_TIME_STATS() timer2_init_20khz()
#define portGET_RUN_TIME_COUNTER_VALUE()         (TIM2->CNT)
```

## Truy vết (tracing)

Khi con số không đủ và bạn cần thấy *trình tự*, hãy dùng công cụ trace:

- **Percepio Tracealyzer** — lựa chọn tham chiếu. Hiện mọi lần chuyển ngữ cảnh, mọi lần chặn
  và mọi lời gọi API trên một trục thời gian, và tìm ra đảo ngược ưu tiên bằng mắt. Thương
  mại, có bản streaming miễn phí.
- **SEGGER SystemView** — miễn phí khi có J-Link, truyền trực tiếp qua RTT, chi phí rất nhỏ.
  Nếu bạn đã có J-Link, hãy bắt đầu từ đây.
- **GPIO + máy phân tích logic** — kéo một chân lên mỗi khi vào một task, qua
  `traceTASK_SWITCHED_IN()`. Thô sơ, miễn phí, và thường là đủ:

```c
/* FreeRTOSConfig.h */
#define traceTASK_SWITCHED_IN()  gpio_set_task_id(pxCurrentTCB->uxTCBNumber)
```

Nhìn thấy một trục thời gian thật một lần sẽ dạy bạn nhiều hơn cả tuần ngồi suy luận về hệ
thống.

## Danh sách kiểm tra khi gỡ lỗi

Khi hệ thống RTOS chạy sai, hãy đi lần lượt danh sách này:

1. **`configASSERT` đã bật chưa?** Bật nó trước tiên. Nó bắt lỗi ưu tiên ISR, handle không
   hợp lệ và dùng sai API ngay tại đúng dòng.
2. **High-water mark của stack.** Task nào còn dưới ~15% dư địa đều là nghi phạm.
3. **Mức heap trống thấp nhất từng có.** Gần 0 nghĩa là đã có lời gọi tạo đối tượng thất bại
   trong im lặng.
4. **Ưu tiên.** Có task ưu tiên cao nào không bao giờ chặn không? Hãy grep các vòng `while`
   không có delay và không có lời gọi chặn.
5. **Ưu tiên ngắt.** Mọi ngắt gọi `FromISR` đều phải có số ≥
   `configMAX_SYSCALL_INTERRUPT_PRIORITY`.
6. **Thứ tự khoá.** Có chỗ nào lấy hai mutex theo thứ tự ngược nhau không?
7. **Timeout.** Có `portMAX_DELAY` nào khi lấy mutex hay khi gửi queue không?

Ba mục đầu chỉ tốn năm phút và giải thích phần lớn vấn đề.

## Tóm tắt cả series

1. RTOS cho gì và lấy đi gì, cùng bài kiểm tra xem bạn có cần nó không.
2. Trạng thái task, giành quyền theo ưu tiên cố định, gán ưu tiên theo rate-monotonic.
3. Queue là cơ chế giao tiếp mặc định; truyền con trỏ và bể buffer.
4. Mutex và semaphore, kế thừa ưu tiên, các quy tắc tránh deadlock.
5. Xử lý ngắt hoãn lại, `FromISR`, và ngưỡng ưu tiên trên Cortex-M.
6. Sơ đồ heap, tính stack dựa trên bằng chứng, phát hiện tràn, chẩn đoán trong sản phẩm.

Sợi chỉ xuyên suốt tất cả: RTOS không cho bạn hành vi thời gian thực. Nó cho bạn *cơ chế* để
xây nên điều đó, còn kỷ luật khi dùng chúng — ưu tiên có đo đạc, đoạn găng có giới hạn, ISR
ngắn gọn, và số liệu thay cho hy vọng — mới là thứ thật sự khiến hệ thống đạt deadline.
