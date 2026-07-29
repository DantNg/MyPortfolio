---
lesson: 6
lang: vi
title: "Kiểm thử firmware và những anti-pattern cản trở nó"
description: "Kim tự tháp kiểm thử cho nhúng, giả lập thời gian và phần cứng, bảy anti-pattern khiến firmware không test được, và một checklist review dùng được thật."
duration: "15 phút"
tags: ["Design pattern", "Kiểm thử", "Review code"]
---

## Cái gì thực sự test được

Không phải mọi thứ đều có thể và nên unit-test. Rõ ràng về việc tầng nào nhận loại kiểm thử
nào là điều giữ cho công sức bỏ ra tương xứng:

| Tầng | Loại kiểm thử | Chạy trên | Tốc độ |
| --- | --- | --- | --- |
| Logic ứng dụng, máy trạng thái, thuật toán | unit | máy tính | mili-giây |
| Driver thiết bị với bus giả | unit | máy tính | mili-giây |
| Driver + ngoại vi thật | tích hợp | thiết bị đích | vài giây |
| Toàn hệ thống | hệ thống / HIL | đích + giàn thử | vài phút |

Hình kim tự tháp rất quan trọng: hàng trăm unit test trên máy tính, hàng chục test tích hợp
trên thiết bị, vài test hệ thống. Lật ngược nó — chủ yếu dựa vào thử tay trên phần cứng — là
thứ khiến firmware chậm thay đổi.

**Nước đi giá trị nhất** là làm cho hàng trên cùng chạy được trên laptop của bạn. Mọi thứ ở
bài 1 tới bài 3 tồn tại để điều đó khả thi.

## Giả lập thời gian

Thời gian là phụ thuộc mà người ta hay quên, và nó làm bài test vừa chậm vừa chập chờn:

```c
/* không test được — một bài test 60 giây, lại phụ thuộc đồng hồ thật */
void check_timeout(void) {
    if (HAL_GetTick() - start > 60000) { handle_timeout(); }
}
```

Hãy tiêm đồng hồ vào như mọi phụ thuộc khác:

```c
typedef struct {
    uint32_t (*now_ms)(void *ctx);
    void     *ctx;
} clock_if_t;

bool timeout_expired(const clock_if_t *clk, uint32_t start, uint32_t limit_ms)
{
    return (clk->now_ms(clk->ctx) - start) >= limit_ms;
}
```

```c
/* bài test kiểm soát hoàn toàn thời gian, và chạy trong vài micro-giây */
static uint32_t fake_now;
static uint32_t fake_now_ms(void *ctx) { return fake_now; }
static const clock_if_t fake_clock = { .now_ms = fake_now_ms };

void test_timeout(void)
{
    fake_now = 1000;
    TEST_ASSERT_FALSE(timeout_expired(&fake_clock, 1000, 60000));

    fake_now = 61000;
    TEST_ASSERT_TRUE(timeout_expired(&fake_clock, 1000, 60000));

    /* trường hợp ai cũng quên: bộ đếm tick tràn ở 2^32 */
    fake_now = 500;
    TEST_ASSERT_TRUE(timeout_expired(&fake_clock, 0xFFFFFF00, 1000));
}
```

Khẳng định cuối cùng đó chính là lý do việc này quan trọng. Tràn bộ đếm tick xảy ra sau 49,7
ngày ở 1 kHz, nghĩa là nó xuất hiện ngoài thực địa và không bao giờ xuất hiện trên bàn bạn —
trừ khi bạn đặt được đồng hồ.

## Kiểm thử máy trạng thái một cách vét cạn

Với hàm step thuần khiết ở bài 2, bạn kiểm thử được mọi ô của ma trận:

```c
void test_no_invalid_transitions(void)
{
    for (state_t s = 0; s < ST_COUNT; s++) {
        for (event_t e = 0; e < EV_COUNT; e++) {
            step_result_t r = charger_step(s, e);
            TEST_ASSERT_TRUE_MESSAGE(r.next < ST_COUNT,
                                     "chuyen tiep sinh ra trang thai khong hop le");
        }
    }
}

void test_safety_invariant(void)
{
    /* quá nhiệt phải dẫn tới FAULT từ mọi trạng thái, không ngoại lệ */
    for (state_t s = 0; s < ST_COUNT; s++) {
        step_result_t r = charger_step(s, EV_OVERTEMP);
        TEST_ASSERT_EQUAL(ST_FAULT, r.next);
    }
}
```

Bài test thứ hai mã hoá thẳng một yêu cầu an toàn. Nếu sang năm có người thêm một trạng thái
mà quên chuyển tiếp quá nhiệt, bản build sẽ hỏng. Đó là bài test có đòn bẩy lớn nhất bạn viết
được cho một máy trạng thái liên quan an toàn.

## Kiểm thử bộ phân tích giao thức

Bộ phân tích là hàm thuần khiết trên các byte, nên nó là thứ dễ kiểm thử tốt nhất trong
firmware — và trong lịch sử cũng là nguồn lỗi bảo mật dồi dào nhất:

```c
void test_parser_handles_split_frame(void)
{
    parser_t p;
    parser_init(&p);

    /* một khung tới thành ba mảnh, đúng như khi đi qua UART */
    TEST_ASSERT_EQUAL(PARSE_INCOMPLETE, parser_feed(&p, (uint8_t[]){0xAA, 0x03}, 2));
    TEST_ASSERT_EQUAL(PARSE_INCOMPLETE, parser_feed(&p, (uint8_t[]){0x01, 0x02}, 2));
    TEST_ASSERT_EQUAL(PARSE_COMPLETE,   parser_feed(&p, (uint8_t[]){0x03, 0x5C}, 2));
}

void test_parser_rejects_bad_crc(void)   { /* ... */ }
void test_parser_rejects_oversize_len(void) { /* ... */ }
void test_parser_recovers_after_garbage(void) { /* ... */ }
```

Nếu bộ phân tích của bạn nhận đầu vào không tin cậy — từ sóng radio, từ một bus, hay từ cổng
USB — hãy fuzz nó:

```c
/* libFuzzer: build và chạy trên máy tính, tìm ra những đầu vào bạn không nghĩ tới */
int LLVMFuzzerTestOneInput(const uint8_t *data, size_t size)
{
    parser_t p;
    parser_init(&p);
    parser_feed(&p, data, size);
    return 0;
}
```

```bash
clang -fsanitize=fuzzer,address parser.c fuzz_parser.c -o fuzz
./fuzz -max_total_time=60
```

Sáu mươi giây fuzzing thường xuyên tìm ra những lỗi tràn buffer mà hàng tháng thử tay không
tìm ra.

## Bảy anti-pattern

Mỗi cái dưới đây đều khiến firmware không test được, và mỗi cái đều có cách sửa máy móc.

### 1. Truy cập thẳng phần cứng từ logic

```c
if (HAL_GPIO_ReadPin(BUTTON_PORT, BUTTON_PIN) == GPIO_PIN_SET) { start_pump(); }
```

**Sửa:** dùng interface (bài 3). Đây là nguyên nhân gốc của phần lớn những cái còn lại.

### 2. Trạng thái toàn cục sửa được

```c
int   g_temperature;
bool  g_pump_running;
float g_setpoint;
```

Các bài test không chạy độc lập được, vì test số 2 nhìn thấy thứ mà test số 1 để lại. **Sửa:**
truyền một struct ngữ cảnh; để biến toàn cục thành `static` và chỉ với tới được qua hàm.

### 3. Delay chặn nằm trong logic

```c
void calibrate(void) {
    start();
    HAL_Delay(5000);      /* bài test giờ mất 5 giây */
    finish();
}
```

**Sửa:** một máy trạng thái cộng một đồng hồ được tiêm vào. Việc hiệu chuẩn trở thành
`calibrate_step(state, now_ms)`.

### 4. Làm mọi thứ trong ISR

```c
void UART_IRQHandler(void) {
    parse_and_execute_command();     /* không test được và chậm */
}
```

**Sửa:** hàng đợi lệnh ở bài 4. ISR đăng lệnh; một task thực thi; bộ phân tích là hàm thuần
khiết bạn test được.

### 5. `#ifdef` rải rác trong logic

```c
#ifdef BOARD_V1
    set_pin(5);
#elif defined(BOARD_V2)
    set_pin(7);
#endif
```

Mỗi tổ hợp là một chương trình riêng chưa được kiểm thử. **Sửa:** đưa phần biến thiên vào một
struct cấu hình hoặc một file hỗ trợ board, và giữ cho logic chỉ có một biến thể.

### 6. Hàm làm năm việc

Một hàm 200 dòng với tám tham số và bốn trách nhiệm thì không thể test cô lập, bởi vì chẳng có
sự cô lập nào. **Sửa:** bài 1. Nếu bạn không mô tả được hàm làm gì trong một câu mà không dùng
chữ "và", hãy tách nó.

### 7. Số ma thuật

```c
if (status & 0x40) { ... }
delay(250);
if (voltage > 3686) { ... }
```

Không ai — kể cả chính bạn, sau ba tháng — nói được liệu một bài test có đang khẳng định đúng
thứ cần khẳng định không. **Sửa:** hằng số có tên kèm đơn vị:

```c
#define STATUS_READY_MASK    (1u << 6)
#define SETTLE_TIME_MS       250u
#define OVERVOLTAGE_MV       3686u   /* 3,686 V */
```

## Dựng một bản build để test

Ceedling cho C:

```bash
gem install ceedling && ceedling new fw && cd fw
ceedling test:all
ceedling gcov:all
```

CMake + CTest, nếu bạn đã dùng CMake:

```cmake
add_library(app_logic STATIC src/charger.c src/parser.c)
target_include_directories(app_logic PUBLIC include)
# lưu ý: không HAL, không header của hãng — đó là thứ khiến nó build được trên máy tính

enable_testing()
add_executable(test_charger test/test_charger.c)
target_link_libraries(test_charger app_logic unity)
add_test(NAME charger COMMAND test_charger)
```

Dòng quan trọng chính là dòng chú thích. Nếu `app_logic` cần HAL của hãng mới liên kết được,
tức là ranh giới đã rò rỉ và bạn nên sửa điều đó trước khi viết thêm test.

Trong CI:

```yaml
test:
  script:
    - ceedling test:all gcov:all
    - cppcheck --enable=all --error-exitcode=1 src/
    - grep -rn "stm32\|HAL_" src/app/ && exit 1 || true   # kiểm tra phân tầng
```

## Checklist khi review

Những câu hỏi thực dụng khi review cấu trúc firmware. Không phải câu nào cũng cần "có" — nhưng
mỗi câu "không" đều nên là một lựa chọn có chủ đích:

**Cấu trúc**

- [ ] Tôi nêu được trách nhiệm của từng module trong một câu không có chữ "và" chứ?
- [ ] Code ứng dụng có include header nào của hãng chip không?
- [ ] Phụ thuộc được truyền vào, hay tự thò tay ra lấy?
- [ ] Có đúng một composition root chứ?

**Trạng thái**

- [ ] Logic máy trạng thái có tách khỏi tác động của nó không?
- [ ] Chuyển tiếp có tường minh và có tên, không dùng `state++` chứ?
- [ ] Mọi trạng thái chờ đều có timeout chứ?
- [ ] Chuyển tiếp có được ghi lại ở đâu đó để đọc sau khi có sự cố ngoài thực địa không?

**Đồng thời**

- [ ] ISR chỉ đăng vào queue thôi chứ?
- [ ] Trạng thái dùng chung có do một task sở hữu, hoặc được bảo vệ bởi đúng một cơ chế thành
      văn không?
- [ ] Mọi khoá đều có timeout và có nhánh xử lý khi thất bại chứ?

**Khả năng kiểm thử**

- [ ] Bộ test có build và chạy được trên máy tính không?
- [ ] Thời gian được tiêm vào, thay vì logic tự đọc `HAL_GetTick()` chứ?
- [ ] Tôi test được các nhánh lỗi chứ không chỉ nhánh thuận lợi chứ?

**Vệ sinh code**

- [ ] Số ma thuật đã được đặt tên kèm đơn vị chưa?
- [ ] Giá trị trả về có được kiểm tra, hoặc bỏ đi tường minh bằng `(void)` chưa?
- [ ] Có `#ifdef` nào xuất hiện trong logic ứng dụng không?

## Tóm tắt cả series

1. SOLID dịch sang firmware, phân tầng, và con trỏ mờ.
2. Máy trạng thái bốn cách, và cách làm cho chúng kiểm thử vét cạn được.
3. Interface và dependency injection trong C; ưu tiên fake hơn mock; composition root.
4. Observer, hàng đợi lệnh và strategy — tách bên sản xuất khỏi bên tiêu thụ.
5. C++ thêm được gì mà không tốn gì lúc chạy, và nên tránh những gì.
6. Kim tự tháp kiểm thử, giả lập thời gian, bảy anti-pattern, và checklist review.

Sợi chỉ xuyên suốt cả sáu bài: **cấu trúc là thứ bạn mua bằng sự gián tiếp, và bạn chỉ nên mua
đúng lượng mà dự án cần.** Một dự án 500 dòng chẳng cần gì trong số này. Một sản phẩm 50.000
dòng với ba biến thể và một yêu cầu an toàn thì cần gần hết. Kỹ năng nằm ở chỗ biết mình đang
làm loại nào — và nhận ra khi nó thay đổi.
