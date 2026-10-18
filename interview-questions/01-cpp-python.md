# 专题一 · C++ & Python 编程语言

> 面向「CV 算法工程 / 工业检测」岗位的高频面试题。C++ 部分按 **语言机制 → C++11 新特性 → 并发与性能** 递进；Python 部分按 **基础与 OOP → 装饰器/生成器等高阶特性** 递进。
>
> 其他专题：`02-pytorch.md`、`03-opencv-isp.md`、`04-cnn-transformer.md`、`05-ai-coding.md`（待产出）。

**使用方式**

- 每题结构固定：`难度/频率` → `考察点` → `参考答案` → `追问` → `坑`。面试时先答"考察点"那句结论，再展开。
- 难度：★☆☆ 能在简历上写就必须脱口而出｜★★☆ 决定过不过｜★★★ 加分项，答不出不致命。
- 标 **〔实现相关〕** 的结论指的是编译器/解释器实现事实（如 GCC 的扩容倍数），标准未规定，答的时候要带上这句限定词——面试官常常就是在考这个。
- 标注 **〔存疑〕** 的是业界有争议或不同资料说法不一致的地方。

**本专题题量分布**

| 分块 | 题号 | 题数 | 说明 |
|---|---|---|---|
| A. C++ 语言机制 | Q1–Q12 | 12 | 多态、对象模型、内存、拷贝控制 |
| B. C++11 新特性 | Q13–Q24 | 12 | 智能指针、移动语义、lambda、auto |
| C. C++ 并发与性能 | Q25–Q34 | 10 | 线程、锁、条件变量、原子、缓存 |
| D. Python 基础与 OOP | Q35–Q45 | 11 | 对象模型、GIL、MRO、容器 |
| E. Python 高阶与工程 | Q46–Q52 | 7 | 装饰器、生成器、协程、工程坑 |
| **F. 快问快答** | Q53–Q97 | **45** | 一题一行，面试前扫读（C++ 35 + Python 10） |
| **G. 深挖题** | Q98–Q103 | **6** | 无锁队列 / 类型擦除 / 编译链接 / 生成器内部 / GC / 描述符 |
| **合计** | | **103** | |

---

# A. C++ 语言机制

## Q1. C++ 的多态是怎么实现的？虚函数调用的开销在哪？★★☆ 高频

**考察点**：说清「虚函数表 + vptr」的对象模型，以及"为什么虚调用比直接调用慢、慢在哪"。

**参考答案**

编译器为**每个含有虚函数的类**生成一张虚函数表（vtable，本质是函数指针数组），并在该类的**每个对象**里放一个隐藏指针 `vptr` 指向它。虚调用 `p->f()` 的步骤是：

1. 从对象首地址取 `vptr`；
2. 用编译期确定的**槽位索引**从 vtable 取出函数地址；
3. 间接跳转调用。

```text
对象内存 (派生类实例)                    虚函数表 (类共享，每个多态类一张)
+------------------+                   +---------------------------+
| vptr  -----------|------------------>| [0] &Derived::f  (覆盖)    |
+------------------+                   | [1] &Base::g     (继承)    |
| int x            |                   | [2] &Derived::h  (新增)    |
| std::string s    |                   | ... RTTI(type_info*)      |
+------------------+                   +---------------------------+
```

开销有三处：**两次内存访问**（读 vptr + 读表项，都可能 cache miss）、**间接跳转**（分支预测失败）、**阻止内联**（编译器不知道目标是谁，后续无法做常量传播等优化）。相比之下 `final` 修饰的类/函数、或者用模板的编译期多态，都能内联。

**追问**

- *vtable 存在哪？* 只读数据段（`.rodata`），由编译器在编译期生成，**不是运行时建的**。
- *对象里为什么必须有 vptr，不能省吗？* 不能——多态要求"通过基类指针找到真实类型的行为"，这个映射只能存在对象里（或由指针附带，那是 `fat pointer` 的思路，C++ 不这么做）。
- *空类为什么 `sizeof == 1`？* 标准要求同类型不同对象地址不同，编译器塞一个 char。但空基类作为基类时会被优化掉（EBO），见 Q5。

**坑**：说"虚函数表在堆上/运行时生成"是常见错误；也别说"每个对象一张 vtable"（是每个**类**一张）。

**出处**：<https://en.cppreference.com/w/cpp/language/virtual>；Itanium C++ ABI 规定了 vtable 布局。

---

## Q2. 为什么基类的析构函数必须声明为 virtual？★★☆ 高频

**考察点**：`delete` 一个基类指针时的行为链。

**参考答案**

`delete base_ptr` 时，如果析构函数**不是虚的**，编译器按**静态类型** `Base` 去析构，只调用 `Base::~Base()`，派生类的成员（尤其是自己 `new` 的资源）不会释放 → **资源泄漏 + 未定义行为**（严格说是 UB，实践中表现为泄漏或崩溃）。

```cpp
struct Base { ~Base() {} };            // 非虚：错
struct Derived : Base {
    int* buf = new int[1024];
    ~Derived() { delete[] buf; }
};
Base* p = new Derived;
delete p;      // 只调用 ~Base()，buf 泄漏
```

判据：**只要这个类可能被基类指针 delete，就必须虚析构**。反过来说，如果不打算被继承（或不允许通过基类指针 delete），就不要加 virtual——加了会引入 vptr，对象变大、失去标准布局（standard-layout），无法 `memcpy`、不能当 C 结构体用。

**追问**

- *虚析构和纯虚析构有什么区别？* 纯虚析构 `virtual ~Base() = 0;` 仍然**必须给出定义**（因为派生类析构时一定要调用基类析构），用于"抽象类但无其他纯虚函数"的场景。
- *构造函数能是虚的吗？* 不能。构造时对象类型还没定型，vptr 尚未初始化到最终形态。
- *析构函数里调用虚函数会怎样？* 见 Q3。

**坑**：`std::shared_ptr<Base> p = std::make_shared<Derived>()` 即使 `~Base` 非虚也**不会**泄漏——因为控制块里记住了真实的删除器类型。这是 shared_ptr 相对裸指针的一个"安全网"，但别拿它当设计依据。

**出处**：<https://isocpp.org/wiki/faq/virtual-functions#virtual-dtors>

---

## Q3. 构造函数和析构函数里能调用虚函数吗？★★☆

**考察点**：对象生命周期各阶段 vptr 指向谁。

**参考答案**

**能编译、能调用，但不会多态**：构造/析构期间 vptr 指向的是**当前正在构造/析构的那一层**的 vtable。

- 构造：`Base` 构造期间 vptr → `Base` 的 vtable，所以 `Base()` 里调 `f()` 调的是 `Base::f`，不是 `Derived::f`。等 `Derived` 的成员初始化列表执行时 vptr 才被改成 `Derived` 的。
- 析构：反过来，`~Derived` 执行完进入 `~Base` 时，vptr 已退回 `Base` 的 vtable。

**纯虚函数在构造/析构中调用会怎样？** 如果该层没有提供定义 → **链接错误**；若提供了定义则是 UB（C++ 标准 [class.cdtor]）；实践中多数实现直接 `pure virtual function call` 崩溃。

**为什么这么设计**：派生类成员此时还不存在（析构时已销毁），调用派生类虚函数会访问未初始化/已释放的内存，必然出 bug。所以语言干脆禁止多态。

**追问**：*那构造函数里要"按子类行为做事"怎么办？* 用两段式初始化（`init()`），或者工厂函数在构造完成后调用虚函数。

**出处**：<https://en.cppreference.com/w/cpp/language/initialization>；标准 §[class.cdtor]。

---

## Q4. 深拷贝、浅拷贝，以及"三法则/五法则/零法则"★★☆ 高频

**考察点**：能否把"资源所有权"讲成一套自洽的规则，而不是背三条。

**参考答案**

**浅拷贝**＝逐成员按位复制，指针成员只复制地址（两个对象指向同一块内存）；**深拷贝**＝为指针成员重新分配并复制内容。默认生成的拷贝构造/拷贝赋值就是浅拷贝。

**三法则**：如果你需要自定义**析构函数、拷贝构造、拷贝赋值**中的任意一个，那你几乎一定三个都需要（典型场景：持有裸资源）。

**五法则**（C++11）：再加上**移动构造、移动赋值**——有了移动语义，把"深拷贝"改成"偷指针 + 把源置空"能省掉一次分配。

**零法则**：更好的做法是**一个都不写**，用 RAII 类型（`std::vector`、`std::string`、`std::unique_ptr`）持有资源，让编译器生成的默认版本自动正确。这是现代 C++ 的默认选择。

```cpp
// 三法则的反例：只写了析构，编译器仍生成浅拷贝版本 → 双重释放
class Bad {
    int* p;
public:
    explicit Bad(int n) : p(new int[n]) {}
    ~Bad() { delete[] p; }
    // 拷贝构造 = 默认 = 复制指针 → 两个对象 delete 同一块内存
};

// 零法则的正解
class Good {
    std::vector<int> buf;   // 拷贝/移动/析构全部由 vector 负责
public:
    explicit Good(size_t n) : buf(n) {}
};
```

**追问**

- *五法则里为什么移动操作要 `noexcept`？* 见 Q18（vector 扩容的 `move_if_noexcept`）。
- *`= default` 和 `= delete` 有什么用？* 前者显式要求编译器生成（可保持平凡性/可平凡复制），后者删除函数（如禁止拷贝：`Good(const Good&) = delete;`）。
- *写了移动构造，拷贝构造还会自动生成吗？* **不会**（被抑制），需要显式 `= default`。反过来写了拷贝构造/析构/拷贝赋值也不会自动生成移动操作——此时"移动"会退化成拷贝。这是个高频陷阱。

**出处**：<https://en.cppreference.com/w/cpp/language/rule_of_three>（Rule of three/five/zero）

---

## Q5. `sizeof` 与内存对齐：空类多大？为什么有 padding？什么是 EBO？★★☆

**考察点**：对象布局的基本功，直接关系到"你的结构体为什么占这么多内存"。

**参考答案**

**空类 `sizeof == 1`**：标准要求同类型的不同对象地址不同，必须有非零大小。空类作为**基类**时可被优化到 0 字节，叫 **EBO（Empty Base Optimization）**——`std::unique_ptr<T>` 就是靠它做到 `sizeof == sizeof(T*)`。

**对齐**：每个类型的对齐要求通常是其最大成员的对齐（不超过 `alignof(std::max_align_t)` 时）。编译器在成员之间插入 padding 以满足对齐，并在尾部补齐到整体对齐的整数倍。

```cpp
struct A { char c; int i; };          // sizeof = 8（c 后 3 字节 padding）
struct B { char c; double d; };       // sizeof = 16
struct C { char c; int i; char c2; }; // sizeof = 12（尾部补 3）
struct Empty {};                      // sizeof = 1
struct D : Empty { int x; };          // sizeof = 4（EBO 生效）
```

**追问**

- *怎么压缩结构体？* 按对齐从大到小排列成员；或用 `#pragma pack` / `__attribute__((packed))` —— 但有代价：非对齐访问在部分平台慢甚至崩溃，且可能触发 UB。
- *`alignas(64)` 干什么用？* 见 Q34 伪共享。
- *`std::vector<T>` 的 `sizeof` 是多少？* 通常是 3 个指针 = 24 字节，**与元素个数无关**（元素在堆上）。

**坑**：`sizeof(std::string)` 是 32（libstdc++，SSO 缓冲 15 字节）——**实现相关**，别在跨平台代码里假设。

**出处**：<https://en.cppreference.com/w/cpp/language/object#Alignment>

---

## Q6. `new/delete` 和 `malloc/free` 有什么区别？为什么 `new[]` 必须配 `delete[]`？★★☆

**参考答案**

| 维度 | `new / delete` | `malloc / free` |
|---|---|---|
| 本质 | **运算符**（可重载） | 库函数 |
| 构造/析构 | 调用构造、析构函数 | 不调用，只给/收回原始内存 |
| 失败 | 抛 `std::bad_alloc`（`new(nothrow)` 返回空） | 返回 `NULL` |
| 大小 | 编译器按类型算 | 手动 `sizeof` |
| 返回类型 | 类型化指针 | `void*`，C++ 里必须强转 |
| 内存来源 | 最终也走 `operator new` → `malloc` | 直接向 OS/分配器要 |

**`new[]` 必须配 `delete[]` 的原因**：`new T[n]` 要为**每个**元素调用构造，`delete[]` 要为每个元素调用析构——它怎么知道 n？实现上会在返回的数组**前面**多分配几个字节存元素个数（cookie），`new[]` 返回的指针指向 cookie 之后。`delete` 不会去读这个 cookie，于是析构次数错乱、还错着释放地址 → UB。

```text
new T[5] 的底层布局（典型实现）：
[ cookie: n=5 ][ T0 ][ T1 ][ T2 ][ T3 ][ T4 ]
                 ^-- new[] 返回的指针指向这里
```

**追问**

- *`new[]` 分配的是 POD 类型，为什么还需要 cookie？* 对于**平凡析构**的类型，标准允许实现省略 cookie（GCC 对 POD 会省略）；但这是实现自由度，不能不写 `delete[]`。
- *`operator new` 能重载来干什么？* 内存池、对象池、对齐分配、统计泄漏（这就是很多 CV 工程里自己写 `CudaMalloc` 封装的原因）。
- *`placement new` 是什么？* 在给定地址上构造对象：`new (buf) T(args)`，用于内存池/共享内存/避免临时分配；必须手动 `p->~T()`。

**出处**：<https://en.cppreference.com/w/cpp/memory/new/operator_new>；<https://en.cppreference.com/w/cpp/language/delete>

---

## Q7. `unique_ptr`、`shared_ptr`、`weak_ptr` 怎么选？★★☆ 高频

**参考答案**

| | `unique_ptr` | `shared_ptr` | `weak_ptr` |
|---|---|---|---|
| 语义 | **独占**所有权，不可拷贝、可移动 | **共享**所有权，引用计数 | **不拥有**，观察者 |
| 大小 | 1 个指针（默认删除器，EBO） | 2 个指针（对象 + 控制块） | 2 个指针（同 shared，指向控制块） |
| 开销 | 零（除多一次 delete 间接调用） | 原子引用计数 + 控制块堆分配 | 需 `lock()` 提升为 shared |
| 场景 | **默认选择**：成员、工厂返回值、pImpl | 真正需要多方共享生命周期 | 打破 `shared_ptr` 循环引用；缓存；观察回调 |

**选型原则**：**默认 `unique_ptr`**，只在确实"多个对象共享同一份资源的所有权、且谁最后走不确定"时才用 `shared_ptr`。`shared_ptr` 不是"更安全的指针"，它是"带引用计数的所有权容器"——滥用会带来原子操作开销、控制块分配、以及最麻烦的**循环引用**。

```cpp
// 典型用法
auto p = std::make_unique<Model>();            // C++14
std::unique_ptr<Model> q = std::move(p);       // 转移所有权，p 变空
std::shared_ptr<Model> s1 = std::make_shared<Model>();
std::weak_ptr<Model> w = s1;                   // 不增加强引用计数
if (auto s2 = w.lock()) { /* 对象还活着 */ }
```

**自定义删除器**（CV 工程里极常见——`cv::Mat`、CUDA 缓冲、文件句柄）：

```cpp
// 捕获状态的 lambda 会让 unique_ptr 变大（不再 EBO）
std::unique_ptr<FILE, decltype(&fclose)> f(fopen("a.bin", "rb"), &fclose);
// 无状态的删除器仍可 EBO，size 保持 8 字节
```

**追问**

- *`unique_ptr` 能管理数组吗？* 能，`std::unique_ptr<T[]>` 会用 `delete[]`。但多数场景 `std::vector` 更合适。
- *为什么 `shared_ptr` 的 deleter 是类型擦除的？* 见 Q8。
- *`weak_ptr` 会不会让对象活得比预期久？* 不会（不增加强计数），但会让**控制块**和 `make_shared` 的那块内存活得久，见 Q9。

**坑**：`std::unique_ptr<Base>(new Derived)` 与 `std::unique_ptr<Base> = std::make_unique<Derived>()` 的区别——后者在构造失败时不会泄漏，且写法更安全。

**出处**：<https://en.cppreference.com/w/cpp/memory/unique_ptr>、<https://en.cppreference.com/w/cpp/memory/shared_ptr>

---

## Q8. `shared_ptr` 的内部结构？引用计数为什么是线程安全的、什么情况下不是？★★★ 高频

**参考答案**

`shared_ptr<T>` 本体是**两个指针**（x86-64 下 16 字节）：一个指向对象 `T*`，一个指向**控制块**。

```text
shared_ptr<T>  ─┬─ ptr ─────────────► [ T 对象 ]
                 └─ ctrl ─────────┐
                                  ▼
             控制块（堆上，独立分配）
             +-------------------------------+
             | strong_count (atomic<long>)   |  强引用数：归 0 → 析构对象
             | weak_count   (atomic<long>)   |  弱引用数：含"隐式 +1"给强引用
             | deleter / allocator (类型擦除) |
             | 指向对象的指针（别名 shared_ptr 时与 ptr 不同） |
             +-------------------------------+
```

**引用计数本身是原子的**：`strong_count` 用 `atomic` 的 `fetch_add/fetch_sub`，所以**不同** `shared_ptr` 实例（各自一份）在多线程里并发拷贝/销毁是安全的。

**不安全的部分**：

1. **同一个 `shared_ptr` 对象被多个线程同时读写**（比如一个线程 `sp = other`、另一个线程 `sp.reset()`）→ **数据竞争**，因为 ptr 和 ctrl 两个指针不是原子地一起改的。标准明确说：同一个实例的并发访问需要外部同步（除非都是 const 操作读同一个值）。
2. **指向对象的访问**完全不管——`shared_ptr` 的线程安全只覆盖计数，不覆盖 `*p`。

```cpp
// 错：两个线程同时改同一个 shared_ptr 实例
void f(std::shared_ptr<X>& sp) { sp = std::make_shared<X>(); }  // 竞争

// 对：各线程持有自己的副本（拷贝时计数原子递增）
void g(std::shared_ptr<X> sp) { /* 用副本 */ }
```

**追问**

- *控制块为什么需要类型擦除？* 因为 `shared_ptr<T>` 的类型里不能带 deleter/allocator（否则不同类型不兼容），所以把"怎么销毁"放进控制块的虚函数/函数指针里。
- *`shared_ptr<void>` 能装任何东西吗？* 能，因为删除动作在控制块里，不依赖 `T`。但 `get()` 出来是 `void*`，要自己转回去。
- *别名构造（aliasing constructor）干什么？* `shared_ptr<Y>(sp, &sp->member)`——共享同一个控制块但指向子对象，典型用于"返回成员指针但要保住父对象生命周期"。

**出处**：<https://en.cppreference.com/w/cpp/memory/shared_ptr>；<https://en.cppreference.com/w/cpp/memory/shared_ptr/atomic>（`std::atomic<std::shared_ptr>` 是 C++20 才有的原子版本）

---

## Q9. `make_shared` 和 `shared_ptr<T>(new T)` 有什么区别？为什么 `weak_ptr` 会拖住内存？★★★

**参考答案**

`make_shared` 把**对象和控制块分配在同一块内存**里（一次 `operator new`）；`shared_ptr<T>(new T)` 是两次分配，控制块单独 `new`。

```text
make_shared:                          shared_ptr(new T):
+---------------------------+         +-------------+     +-------------+
| 控制块 | T 对象            |         | 控制块       |     | T 对象       |
+---------------------------+         +-------------+     +-------------+
 强引用归 0 → 先析构 T；              强引用归 0 → 析构 T，释放对象块；
 弱引用也归 0 → 整块释放              弱引用归 0 → 释放控制块（两次释放）
```

**代价**：`make_shared` 下，**只要还有一个 `weak_ptr` 活着，整块内存（含已析构的 T）都释放不掉**。这就是"大对象 + 长生命周期 weak_ptr（或 `enable_shared_from_this` 的回调注册表）"导致内存迟迟不降的常见原因。

**另一个区别**：`make_shared` 无法指定自定义删除器；而且它对 `T` 的构造是"完美转发"，无法使用 `{}` 初始化列表（`std::make_shared<T>({1,2})` 不行，得 `std::make_shared<std::vector<int>>(std::initializer_list<int>{1,2})`）。

```cpp
auto a = std::make_shared<Big>();        // 1 次分配，快、局部性好
auto b = std::shared_ptr<Big>(new Big);  // 2 次分配；但异常安全（C++17 前 make_shared 更安全）
```

**追问**

- *为什么 C++17 之后 `shared_ptr<T>(new T)` 也异常安全了？* 因为求值顺序规则改了（函数参数求值不再交错），`new T` 完成后紧接着构造 shared_ptr，中间不会插入别的可能抛异常的操作。C++17 之前用 `f(std::shared_ptr<T>(new T), g())` 这种写法可能泄漏。

**出处**：<https://en.cppreference.com/w/cpp/memory/shared_ptr/make_shared>

---

## Q10. `shared_ptr` 的循环引用怎么产生、怎么破？★★☆ 高频

**参考答案**

两个对象互相持有 `shared_ptr` → 强引用计数永远 ≥1 → 谁都不会析构 → 内存泄漏。

```cpp
struct Node {
    std::shared_ptr<Node> next;
    std::shared_ptr<Node> prev;   // 环：a->next=b, b->prev=a
};
auto a = std::make_shared<Node>();
auto b = std::make_shared<Node>();
a->next = b;
b->prev = a;       // 两个对象都出作用域后，计数仍是 1，永久泄漏
```

**解法**：把**一边**改成 `weak_ptr`（"父子"关系里让子持有父的弱引用；观察者回调用 weak）。

```cpp
struct Node {
    std::shared_ptr<Node> next;   // 强：拥有后继
    std::weak_ptr<Node>   prev;   // 弱：只观察，不拥有
};
```

**追问**

- *怎么发现循环引用？* `weak_ptr` 计数不为 0 而强计数为 0 就说明有环；工具上 Valgrind / ASan（`-fsanitize=address`）/ 自己重载 `operator new` 统计。
- *GPU/CV 场景的同类问题*：`cv::Ptr`（OpenCV 的智能指针）是 `shared_ptr` 语义，同样会循环引用；CUDA 的 `cv::cuda::GpuMat` 本身不自动管理流同步，别指望智能指针解决。

**出处**：<https://en.cppreference.com/w/cpp/memory/weak_ptr>

---

## Q11. 迭代器失效规则：`vector`、`deque`、`map` 各是什么情况？★★☆ 高频

**参考答案**

| 容器 | 插入 | 删除 |
|---|---|---|
| `vector` | `push_back` **可能**使全部迭代器/引用失效（扩容搬家）；`insert` 使**插入点及之后**失效 | `erase` 使**删除点及之后**失效 |
| `deque` | 两端插入：迭代器全部失效，**引用不失效**（分段存储）；中间插入：全部失效 | 两端删除：只失效被删的；中间删除：全部失效 |
| `list` | 不失效（只有被删节点） | 不失效 |
| `map/set` | 不失效 | 不失效 |
| `unordered_*` | `rehash` 时**迭代器**全失效，但**引用/指针不失效**（节点不动） | 只失效被删的 |

**为什么 `vector` 扩容这么关键**：扩容要在别处重新分配 + 搬元素，原来的地址全变了。所以有经验的代码会先 `reserve(n)`。

**典型错误写法**：

```cpp
for (auto it = v.begin(); it != v.end(); ++it)
    if (bad(*it)) v.erase(it);          // 错：erase 后 it 已失效
// 对：
for (auto it = v.begin(); it != v.end(); )
    if (bad(*it)) it = v.erase(it);     // erase 返回下一个有效迭代器
    else ++it;
// 或 C++20：std::erase_if(v, pred);
```

**追问**

- *`deque` 为什么两端插入不失效引用？* 它是"分段数组 + 中控 map"，两端插入只需新增一段，已有元素不搬家；但迭代器里存了段的索引，中控表一扩容就全废。
- *`map` 删除时会失效其他节点吗？* 不会。红黑树节点各自独立分配。

**出处**：<https://en.cppreference.com/w/cpp/container/vector>（Iterator invalidation 小节）

---

## Q12. `static`、`const`、`constexpr`、`inline`、`extern` 各管什么？★★☆

**参考答案**（容易混，建议用"它改变了什么"来记）

| 关键字 | 作用 |
|---|---|
| `static`（全局/命名空间） | **内部链接**：只在本翻译单元可见（等价 C 的 `static`） |
| `static`（局部） | **静态存储期**：只初始化一次，函数退出不销毁；C++11 起**局部 static 初始化是线程安全的**（magic statics） |
| `static`（成员变量） | 属于类而非对象，**类外定义**（C++17 可 `inline static`） |
| `static`（成员函数） | 无 `this`，不能访问非静态成员 |
| `const`（成员函数后缀） | 承诺不改对象状态；`mutable` 成员例外 |
| `constexpr` | **编译期可求值**（能用在模板参数、数组大小、`case` 标签）；比 `const` 强——`const` 只保证"运行期不变" |
| `inline` | 允许在头文件里定义（多 TU 合并时选一个），也是编译器内联**提示**（现代编译器的内联决策基本不看它） |
| `extern` | 声明"这个变量/函数在别处定义"，用于跨 TU 共享 |

```cpp
// 单例：C++11 起线程安全的局部 static（Meyers Singleton）
S& instance() { static S s; return s; }   // 首次调用时构造，退出时析构
```

**坑**：`constexpr` 函数里不能有 `new`/`try`（C++20 前）；`static` 局部变量的析构顺序与构造顺序**相反**，跨 TU 的静态对象初始化顺序未定义（static initialization order fiasco）——工程里用"函数内 static"来规避。

**出处**：<https://en.cppreference.com/w/cpp/language/storage_duration>；<https://en.cppreference.com/w/cpp/language/constexpr>

---

# B. C++11 新特性

## Q13. C++11 最重要的几个新特性，用一句话说清各自解决什么问题。★★☆ 高频

**参考答案**（这题的答法是"分类 + 每类一句价值"）

| 分类 | 特性 | 解决的问题 |
|---|---|---|
| 资源管理 | **智能指针**、`=delete` | 手写 delete 导致的泄漏/双重释放 |
| 值语义 | **右值引用 + 移动语义**、`noexcept` | 大对象"只读地拷贝"的性能浪费 |
| 泛型 | `auto`、`decltype`、**可变参数模板**、`constexpr` | 手写冗长类型；编译期计算 |
| 便捷 | **lambda**、`range-for`、`nullptr`、统一初始化 `{}` | 函数对象样板代码；`NULL` 歧义 |
| 并发 | `std::thread`、`mutex`、`condition_variable`、`atomic`、`future` | 跨平台并发（之前只能靠 pthread/Win32） |
| 类型安全 | `enum class`、`override`/`final` | 弱类型枚举、虚函数写错签名不报错 |

面试时挑你能展开的 3–4 个讲透（**移动语义、智能指针、lambda、并发**是必问的），而不是罗列 20 个名词。

---

## Q14. 右值引用是什么？`std::move` 到底移动了什么？★★☆ 高频

**参考答案**

**核心一句话**：`std::move` **不移动任何东西**，它只是一个 `static_cast<T&&>`，把左值"标记"成右值，让重载决议去选**移动构造/移动赋值**。真正搬资源的是你（或标准库）写的移动构造函数。

```cpp
std::string a = "hello";
std::string b = std::move(a);   // 调 string 的移动构造：b 接管 a 的堆缓冲
                                // a 现在处于"有效但未指定"状态（通常为空）
```

**移动构造的典型实现**：偷指针 + 把源置为可析构状态。

```cpp
class Buffer {
    int* data_; size_t n_;
public:
    Buffer(Buffer&& o) noexcept : data_(o.data_), n_(o.n_) {   // 偷
        o.data_ = nullptr; o.n_ = 0;                            // 置空，防止双重释放
    }
    Buffer& operator=(Buffer&& o) noexcept {                    // 注意自赋值
        if (this != &o) { delete[] data_; data_ = o.data_; n_ = o.n_; o.data_=nullptr; o.n_=0; }
        return *this;
    }
};
```

**左值 vs 右值**：左值有名字、可取地址；右值是临时对象/将亡值。`std::move` 之后的对象**仍然有效**（能析构、能赋值），但值不确定——不要再读它。

**追问**

- *对 `const` 对象 `std::move` 会怎样？* `const T&&` 绑定不到 `T&&`（移动构造要改源），于是**退化为拷贝**。这是个静默的性能坑。
- *为什么 `std::move` 的返回值不要加 `const`？* 同上，会阻止移动。
- *`return std::move(local);` 对吗？* **不对**，反而会阻止 RVO/NRVO，还可能多一次移动。直接 `return local;`。

**出处**：<https://en.cppreference.com/w/cpp/utility/move>；<https://en.cppreference.com/w/cpp/language/reference#Rvalue_references>

---

## Q15. 完美转发怎么实现？引用折叠规则是什么？★★★

**参考答案**

**引用折叠**（只在类型推导/别名场景出现）：

```text
T&  &   → T&        T&  &&  → T&
T&& &   → T&        T&& &&  → T&&
```

口诀：**只要有一个 `&`，结果就是 `&`；只有全是 `&&` 才是 `&&`**。

**`std::forward<T>`** 的作用：当 `T` 被推导为 `U&`（实参是左值）时，`forward` 返回 `U&`；当 `T` 是 `U`（实参是右值）时，返回 `U&&`——从而**保持实参原本的值类别**。

```cpp
template <class T>
void wrapper(T&& arg) {                 // 转发引用（universal reference）
    target(std::forward<T>(arg));       // 左值原样传左值，右值原样传右值
}

void target(const std::string&);        // 左值版本
void target(std::string&&);             // 右值版本
```

**`T&&` 什么时候是右值引用、什么时候是转发引用？** 只有**同时满足**"形如 `T&&`"且"`T` 是正在被推导的模板参数"时才是转发引用；`std::vector<T>&&`、`const T&&` 都不是。

**追问**

- *为什么 `auto&&` 也叫转发引用？* 因为 `auto` 参与推导。
- *不使用 `forward` 只用 `T&&` 会怎样？* 形参 `arg` 本身是**左值**（有名字），会无条件按左值传下去，右值语义丢失。
- *完美转发在工程里的位置*：`make_unique`、`emplace_back`、日志/工厂封装——每次 `emplace_back` 就是一次完美转发。

**出处**：<https://en.cppreference.com/w/cpp/utility/forward>；<https://en.cppreference.com/w/cpp/language/reference#Reference_collapsing>

---

## Q16. 移动构造函数为什么要加 `noexcept`？★★★ 高频（很多人答不全）

**参考答案**

因为 **`std::vector` 扩容时的强异常安全保证**依赖它：扩容要先把旧元素搬到新内存，再用新内存替换旧内存。如果搬的过程中**抛异常**，vector 必须能回滚到"原样"——这就要求"搬"这一步不能失败。移动构造如果可能抛异常，就没法保证回滚（旧元素可能已被改得面目全非）。

所以标准库的策略是 `std::move_if_noexcept`：**移动构造是 `noexcept`（或没有拷贝构造可用）时才移动，否则退化用拷贝。**

```cpp
// 你的类型移动构造没有 noexcept → vector 扩容时全走拷贝，性能白送
struct Big {
    Big(Big&& o) /* 忘了 noexcept */ : data_(std::move(o.data_)) {}
};
```

**追问**

- *加了 `noexcept` 但内部真的抛了会怎样？* 直接 `std::terminate`——所以只在**确实不会抛**的时候加。分配内存（`new`/`vector::push_back`）本身会抛的，就不能标 noexcept。
- *哪些操作天生可以 noexcept？* 移动 `std::unique_ptr`、`std::vector` 的移动、`std::string` 的移动（SSO 情况下也不抛）。

**出处**：<https://en.cppreference.com/w/cpp/utility/move_if_noexcept>；标准 §[container.requirements.general] 对 `noexcept` 的要求。

---

## Q17. `auto`、`decltype`、`decltype(auto)` 的区别？`auto` 会丢掉什么？★★☆

**参考答案**

- `auto` **按值推导**（模板实参推导规则）：**丢弃顶层 `const` 和引用**。
- `decltype(expr)`：**精确保留**表达式的类型与值类别（`decltype((x))` 是 `int&`，`decltype(x)` 是 `int`）。它不求值。
- `decltype(auto)`：用 `decltype` 的规则推导返回类型，常用于**转发返回值**（保住引用）。

```cpp
const int  ci = 0;
const int& cr = ci;
auto  a = cr;          // int（丢了 const 和 &）
auto& b = cr;          // const int&
decltype(cr)  d = ci;  // const int&
decltype(ci)  e = ci;  // const int
auto f() -> decltype(auto) { return cr; }   // 返回 const int&
```

**追问**

- *`auto` 用在 `for (auto x : v)` 里有什么坑？* 会**拷贝**每个元素；要改就 `auto&`，只读就 `const auto&`，别养成 `auto` 一把梭。
- *`auto` 能推导 `std::initializer_list` 吗？* `auto x = {1,2,3};` 推成 `std::initializer_list<int>`；`auto x{1};` 在 C++17 起推成 `int`（之前是 initializer_list）。

**出处**：<https://en.cppreference.com/w/cpp/language/auto>；<https://en.cppreference.com/w/cpp/language/decltype>

---

## Q18. lambda 的捕获列表有哪些形式？`[=]` 捕获 `this` 时发生了什么？★★☆ 高频

**参考答案**

- `[]` 不捕获；`[x]` 按值；`[&x]` 按引用；`[=]` 按值捕获**用到的**外部变量；`[&]` 按引用；`[this]` 捕获当前对象指针；`[=, &y]` 混合（默认值 + 例外）。
- C++14 起：**初始化捕获**（广义捕获）`[p = std::move(ptr)]`，可以把 `unique_ptr` 搬进闭包；`[&r = ref]` 给引用起别名。
- C++14 起：**泛型 lambda** `[](auto x){...}`（本质是带模板 `operator()` 的闭包）。

```cpp
int a = 1, b = 2;
auto f1 = [=]() { return a + b; };          // 按值拷贝 a、b
auto f2 = [&]() { a++; };                   // 引用，注意生命周期
auto f3 = [p = std::make_unique<int>(5)]() { return *p; };  // 移动捕获
auto f4 = [](auto x, auto y) { return x + y; };             // 泛型
```

**`[=]` 捕获 `this` 的真相**：C++17 前 `[=]` 会**隐式捕获 `this` 指针**（拷贝的是指针，不是对象内容）；C++20 起 `[=]` 不再隐式捕获 `this`，需要显式 `[this]` 或 `[*this]`（按值拷贝整个对象）。

**危险点**：按值捕获的 lambda 如果被存到比捕获变量活得更久的地方（回调注册、异步任务），就是**悬垂引用/悬垂指针**。

```cpp
std::function<void()> make_bad() {
    int local = 42;
    return [&local]() { return local; };   // 返回后 local 已销毁 → UB
}
```

**追问**

- *lambda 的大小是多少？* 等于按值捕获的变量总和（对齐后），无捕获的 lambda 通常是 1 字节（可转成函数指针）。
- *lambda 能递归吗？* 不能直接（无名），要 `std::function` 或 Y-combinator 技巧，或 C++23 的 deducing this。
- *`mutable` 干什么？* 允许修改按值捕获的副本（默认闭包的 `operator()` 是 `const`）。

**出处**：<https://en.cppreference.com/w/cpp/language/lambda>

---

## Q19. `std::function` 和模板有什么性能差别？什么时候用哪个？★★★

**参考答案**

`std::function` 是**类型擦除**的可调用对象容器（能装函数指针、lambda、bind 结果、成员函数指针）。代价：

1. **间接调用**：内部通过虚函数/函数指针转发，编译器难以内联；
2. **可能的堆分配**：可调用对象超出 SBO（小对象缓冲，libstdc++ 通常 16 字节）就 `new` 一块；
3. **构造/析构非平凡**：拷贝一次可能要分配。

相比之下，模板参数 `template<class F> void run(F f)` 是**编译期多态**：类型已知 → 完全内联 → 零开销，代价是**每个 lambda 都生成一份代码**（代码膨胀）、且类型出现在头文件里（编译慢、ABI 不友好）。

**结论**：热路径（逐像素、每帧回调）用模板；**接口边界/存储回调**（`std::map<int, std::function<...>>`、事件系统、跨模块 API）用 `std::function`。

```cpp
// 热路径：模板，能内联
template <class F> void forEachPixel(F&& f);
// 存储/传参：类型擦除
void setCallback(std::function<void(int)> cb);
```

**追问**：*能不能两者兼得？* C++23 的 `std::move_only_function`（支持只移动类型）、以及自己写 SBO 的小型 `function_ref`（不拥有、只引用）是常见工程折中。

**出处**：<https://en.cppreference.com/w/cpp/utility/functional/function>

---

## Q20. `nullptr` 为什么优于 `NULL`？★★☆

**参考答案**

`NULL` 是宏，通常是 `0` 或 `(void*)0`，**不是指针类型**。于是：

```cpp
void f(int);
void f(char*);
f(NULL);      // 歧义/选错重载：很多实现把 NULL 当 0 → 调 f(int)
f(nullptr);   // 明确调用 f(char*)
```

`nullptr` 是 `std::nullptr_t` 类型的**纯右值**，能隐式转换成任意指针类型，但**不能转成整数**；它还参与模板推导（`f(nullptr)` 能推出 `nullptr_t`），并且 `sizeof(nullptr) == sizeof(void*)`。

**追问**：*`nullptr` 能比较大小吗？* 能，`nullptr < p` 合法（有定义），但 `NULL < p` 在一些实现上是"指针和整数比较"，语义不同。

**出处**：<https://en.cppreference.com/w/cpp/language/nullptr>

---

## Q21. `enum class` 相比 `enum` 好在哪？★★☆

**参考答案**

1. **强类型**：不会隐式转 `int`，不同枚举类型之间不能互相比/赋值（旧的 `enum` 会静默转换）。
2. **作用域**：`Color::Red`，不会和别处的 `Red` 冲突（旧 enum 的枚举名泄漏到外层作用域）。
3. **可指定底层类型**：`enum class Color : uint8_t`，能控制大小（序列化/网络协议/GPU 常量内存时有用）。
4. **前置声明**：可以只声明不定义（旧 enum 不行，除非指定底层类型）。

**坑**：`enum class` 要转 int 必须 `static_cast<int>(Color::Red)`；做位标志时要么重载运算符，要么用 `enum class Flags : uint32_t` + `operator|`。

**出处**：<https://en.cppreference.com/w/cpp/language/enum>

---

## Q22. `override` 和 `final` 解决什么问题？★★☆

**参考答案**

`override` 让编译器**检查**你确实在覆盖基类虚函数。典型事故：基类 `virtual void draw() const`，派生类写 `void draw()`——**签名不同**，不是覆盖而是**隐藏**，编译器不报错，运行时调不到你的实现。加 `override` 立刻编译报错。

`final` 修饰类 → 禁止继承；修饰虚函数 → 禁止再覆盖。除了表达意图，它还**帮编译器去虚化**（知道没有更派生的实现，可以内联/直接调用）。

**坑**：`override` 和 `final` 是**上下文关键字**，不是保留字，可以当变量名（但不建议）。

**出处**：<https://en.cppreference.com/w/cpp/language/override>

---

## Q23. `std::array`、`std::vector`、原生数组怎么选？★★☆

**参考答案**

| | 大小 | 存储 | 边界检查 | 适用 |
|---|---|---|---|---|
| `T a[N]` | 编译期 | 栈（若局部） | 无 | 极致性能、C 接口、constexpr 数据表 |
| `std::array<T,N>` | 编译期 | 栈/成员内 | `at()` 有 | **首选**：有 `size()`、可拷贝、零开销、能当聚合初始化 |
| `std::vector<T>` | 运行期 | 堆 | `at()` 有 | 动态长度，绝大多数场景 |

CV 工程里 `std::array<float,9>` 常用于 3×3 矩阵、`std::array<Point,4>` 用于四边形角点——比 `cv::Mat` 轻、能 `constexpr`、能直接进结构体。

**坑**：`std::array` 不会退化成指针，但传参时会被**拷贝**（`std::array<float,9>` 是值语义），大数组要传 `const&`。

**出处**：<https://en.cppreference.com/w/cpp/container/array>

---

## Q24. `constexpr` 能做什么？它和"运行期优化"是什么关系？★★★

**参考答案**

`constexpr` 表示"**在常量表达式语境下可以编译期求值**"——不是"一定在编译期求值"。同一个 `constexpr` 函数在常量上下文（模板参数、数组大小、`static_assert`）里编译期算，在运行期上下文里就是普通函数（可能被内联）。

```cpp
constexpr int square(int x) { return x * x; }
int a[square(4)];                       // 编译期：数组大小 16
static_assert(square(3) == 9);          // 编译期断言
int n = readInt(); int b = square(n);   // 运行期：普通函数
```

C++14 起 `constexpr` 函数可以有循环、局部变量、多条语句；C++17 有 `if constexpr`（编译期分支，模板元编程的替代）；C++20 有 `consteval`（**必须**编译期求值）和 `constinit`。

**工程价值**：把查表、参数校验、坐标变换矩阵、颜色转换系数放到编译期，运行时零成本——CV 里做色彩空间转换的 3×3 矩阵、ISP 的 gamma 表都很适合。

**坑**：`constexpr` 函数里不能有 `try`、`new`（C++20 前）、虚调用（C++20 前）。

**出处**：<https://en.cppreference.com/w/cpp/language/constexpr>

---

# C. C++ 并发与性能

## Q25. `std::thread` 的 `join` 和 `detach` 有什么区别？析构时会发生什么？★★☆ 高频

**参考答案**

- `join()`：阻塞等待线程结束并回收资源；调用后 `joinable()` 变 false。
- `detach()`：分离，线程在后台独立运行，`std::thread` 对象不再关联它；**你失去了等待和同步的手段**，且主线程退出时进程终止会打断它。

**关键**：`std::thread` 析构时如果仍然 `joinable()` → **调用 `std::terminate()`**（直接崩）。所以**必须**在析构前 join 或 detach。

```cpp
{
    std::thread t(work);        // 若 work 抛异常走到这里
}                               // ← 析构 → terminate()，整个进程挂掉
```

**正确写法**（RAII 包装，C++20 有 `std::jthread`）：

```cpp
class ThreadGuard {
    std::thread t_;
public:
    explicit ThreadGuard(std::thread t) : t_(std::move(t)) {}
    ~ThreadGuard() { if (t_.joinable()) t_.join(); }   // 或 joinable 时 detach
};
```

**追问**

- *`detach` 的线程能用局部变量吗？* 不能——栈会随函数返回销毁。必须按值捕获或 `shared_ptr` 持有数据。
- *`std::jthread` 好在哪？* 析构时自动 `request_stop()` + `join()`，并内建 `stop_token` 协作式取消。

**出处**：<https://en.cppreference.com/w/cpp/thread/thread/~thread>

---

## Q26. `mutex`、`lock_guard`、`unique_lock`、`scoped_lock` 怎么选？★★☆ 高频

**参考答案**

| | 自动加/解锁 | 能手动 unlock | 能延迟加锁 | move | 场景 |
|---|---|---|---|---|---|
| `lock_guard` | ✅ | ❌ | ❌ | ❌ | **默认**，最短小 |
| `unique_lock` | ✅ | ✅ | ✅（`defer_lock`） | ✅ | 需要配合 `condition_variable`、需要中途解锁 |
| `scoped_lock`(C++17) | ✅ | ❌ | ✅ | ❌ | **多锁防死锁**，可替代 `std::lock` + guard |

**为什么 `condition_variable::wait` 必须用 `unique_lock`？** 因为 `wait` 要在阻塞前**解锁**、被唤醒后**重新加锁**——`lock_guard` 没有这个能力。

**死锁的经典修法**：

```cpp
// 错：两个线程以相反顺序加锁 → 死锁
// 对（C++17）：
std::scoped_lock lk(m1, m2);        // 内部用 std::lock，避免死锁
```

**追问**

- *`std::lock` 用的什么策略？* 实现通常用 `try_lock` + 回退（避免活锁），标准只要求"不死锁"。
- *递归加锁会怎样？* `std::mutex` 上递归加锁是 UB（通常直接死锁）；需要递归就用 `std::recursive_mutex`。
- *`shared_mutex` 解决什么？* 读多写少：`shared_lock` 共享读，`unique_lock` 独占写。

**出处**：<https://en.cppreference.com/w/cpp/thread/scoped_lock>

---

## Q27. 死锁的四个必要条件是什么？工程上怎么防？★★☆

**参考答案**

四个必要条件（Coffman 条件）：**互斥、持有并等待、不可剥夺、循环等待**。破坏任意一个即可。

工程手段：

1. **固定加锁顺序**（最有效、最常用）：给锁编号，永远按编号从小到大加。
2. **一次加完**：`std::scoped_lock(m1, m2)` / `std::lock`。
3. **`try_lock` + 超时**：`std::timed_mutex::try_lock_for`，失败就回退重试（避免无限等待）。
4. **缩小临界区**：不在持锁时做 I/O、不回调外部代码（回调里可能再拿锁）。
5. **避免嵌套**：能用无锁/原子就用；能用消息传递替代共享内存。

**CV 工程实例**：图像采集线程持有 `frame_mutex` 再调推理线程的 `result_mutex`，推理线程反过来先拿 `result_mutex` 再要 `frame_mutex` → 死锁。修法：固定顺序（永远先 frame 后 result），或改成"采集写环形缓冲、推理读"的单向依赖。

**追问**：*活锁（livelock）和死锁的区别？* 活锁是线程还在跑但一直在重试、无法推进（如两个线程都 `try_lock` 失败后退让，步调一致地反复碰撞）——用随机退避解决。

**出处**：<https://en.cppreference.com/w/cpp/thread/mutex>；Coffman 1971 原始论文。

---

## Q28. `condition_variable` 为什么必须用 `while` 而不是 `if`？★★★ 高频

**参考答案**

两个原因：**虚假唤醒（spurious wakeup）** 和 **丢失唤醒/被抢占**。

标准明确允许 `wait` 在没有 `notify` 的情况下返回——这叫虚假唤醒，平台相关、不可预测。另外即使是真的被唤醒，从"被唤醒"到"重新拿到锁"之间，另一个线程可能已经抢先改掉了条件。所以**醒来后必须重新检查条件**。

```cpp
std::mutex m; std::condition_variable cv; bool ready = false;

// 消费者
std::unique_lock<std::mutex> lk(m);
cv.wait(lk, [] { return ready; });      // 等价于 while (!ready) cv.wait(lk);
// 此时持有锁，且 ready == true

// 生产者
{
    std::lock_guard<std::mutex> lk(m);  // 改条件必须持锁
    ready = true;
}
cv.notify_one();                        // 通知可以放在锁外（减少唤醒后的争抢）
```

**三个必须**：① 改条件时持锁；② 用 while/predicate 重查；③ `wait` 前检查条件（防止"通知先于 wait"导致永久阻塞）。

**追问**

- *`notify_one` 该在锁内还是锁外？* 两者都正确（有些实现锁外更高效，避免被唤醒线程立刻阻塞在锁上）；关键是**改条件必须持锁**。
- *`wait_for` 返回 `timeout` 还是 `no_timeout`？* 返回值是 `cv_status`，且即使超时也要重查条件。
- *和信号量的区别？* 条件变量**无状态**（没有 notify 就丢了），信号量有计数。

**出处**：<https://en.cppreference.com/w/cpp/thread/condition_variable>

---

## Q29. `std::atomic` 和 `volatile` 有什么区别？为什么 `volatile` 不能做同步？★★★

**参考答案**

`volatile` 只保证"编译器不要把这个变量的读写优化掉/合并掉"（它服务于 MMIO、信号处理等），但**不提供原子性、不提供内存序、不阻止 CPU 重排序**。用它做线程间标志位是教科书级的错误：

```cpp
volatile bool stop = false;     // 错
// 线程 A: while (!stop) { work(); }   ← 编译器仍可能把它读进寄存器循环（某些情况下），
//                                      ← 且非原子，与线程 B 的写构成数据竞争 → UB
```

正确做法：`std::atomic<bool> stop{false};`（默认 `memory_order_seq_cst`），或 C++20 的 `std::atomic_flag` + `stop_token`。

**`memory_order` 速记**：

| 序 | 保证 | 用途 |
|---|---|---|
| `relaxed` | 只保证原子性，不保证顺序 | 计数器、统计 |
| `acquire`（读）/ `release`（写） | release 之前的写，对 acquire 之后的读可见（**发布-订阅**） | 无锁队列、`shared_ptr` 计数、标志位 |
| `seq_cst` | 全局单一总序（默认） | 拿不准时用它 |

```cpp
// 发布-订阅的经典写法
data = 42;                                        // 1. 准备数据
flag.store(true, std::memory_order_release);      // 2. 发布（1 不会重排到 2 之后）
// 另一线程
while (!flag.load(std::memory_order_acquire)) {}  // 3. 订阅
assert(data == 42);                               // 4. 保证可见
```

**追问**

- *`atomic<int>` 一定无锁吗？* 不一定，`is_lock_free()` 要查；大于机器字长的类型可能内部用锁。
- *`atomic` 的复合操作是原子的吗？* `x++` 是原子 RMW；但 `x = x + 1` 是"读-改-写"三步，非原子复合操作。
- *C++20 有什么改进？* `atomic<T>::wait/notify`（免 cv 的等待）、`std::atomic_ref`、`std::atomic<std::shared_ptr<T>>`。

**出处**：<https://en.cppreference.com/w/cpp/atomic/memory_order>；<https://en.cppreference.com/w/cpp/language/cv>

---

## Q30. `std::async` 有哪些坑？★★★

**参考答案**

1. **默认策略是 `async | deferred`**：实现**自己决定**是开线程还是延迟执行。如果选了 `deferred`，**函数直到你调 `.get()`/`.wait()` 才执行**；如果你从不 get，它**根本不会运行**。
2. **析构阻塞**：`std::async` 返回的 `future` 析构时，如果任务是 `async` 策略，会**等待任务完成**——这会让"以为异步发出去就走"的代码卡住。
3. **线程数不可控**：每次 `std::async` 可能新建线程（libstdc++ 的实际行为），没有线程池语义。
4. **异常被吞**：异常存进 future，只有 `get()` 时才重新抛出——忘记 get 就静默丢失。

```cpp
auto f = std::async(std::launch::async, work);   // 显式要求异步
// ...
f.get();                                          // 必须，否则异常丢失/Destroy 阻塞
```

**工程建议**：需要"真正的线程池 + 可控并发"时用自己/第三方线程池（如 `Taskflow`、`oneTBB`、`concurrentqueue`），别用 `std::async` 当池子。

**追问**：*`promise`/`packaged_task` 什么时候用？* 当你需要**手动设置值/异常**（promise）或把可调用对象**排队**到线程池再取结果（packaged_task）。

**出处**：<https://en.cppreference.com/w/cpp/thread/async>

---

## Q31. 什么是伪共享（false sharing）？怎么避免？★★★

**参考答案**

CPU 缓存以 **cache line（通常 64 字节）** 为单位同步。两个线程分别频繁写**同一个 cache line 里的不同变量**时，该 line 在两个核之间来回失效，性能可能比单线程还差几倍——这就是伪共享。

```cpp
// 两个线程各写一个计数器，但它们挨在一起 → 同一个 cache line
struct Counters { std::atomic<long> a; std::atomic<long> b; };   // 坏

struct Counters {
    alignas(64) std::atomic<long> a;
    alignas(64) std::atomic<long> b;      // 各占一条 cache line
};
```

**追问**

- *C++17 的 `std::hardware_destructive_interference_size` 是什么？* 标准库提供的"建议不共享的间距"常量（常见 64），但它对 ABI 不稳定，很多项目仍硬编码 64。
- *CV 工程哪里会遇到？* 多线程按行切分图像时，每个线程的局部统计量（耗时、像素和）如果放在同一个结构体里就会伪共享；一般让每个线程写自己的 `vector<T>`（按 64 对齐）。

**出处**：<https://en.cppreference.com/w/cpp/thread/hardware_destructive_interference_size>

---

## Q32. 线程池怎么设计？核心要素有哪些？★★★

**参考答案**（这题考的是工程结构感，答结构 + 关键决策）

```text
任务队列 (mutex + condition_variable + deque<function<void()>>)
     ▲ 生产者 push                │ 消费者 pop
     │                            ▼
  submit(f) ────────────────►  工作线程 × N（循环取任务执行）
                                 │
                            停止标志 + jthread/stop_token（协作式退出）
```

关键决策点：

1. **队列**：`std::deque<std::function<void()>>` + `mutex` + `condition_variable` 最简单；高吞吐用无锁队列（代价是内存序要写对）。
2. **优雅退出**：置 `stop_` → `notify_all` → 线程把队列**剩余任务跑完**再退出（否则丢任务）；`jthread` 用 `stop_token`。
3. **任务类型**：要支持返回值就用 `packaged_task` + `future`；要支持优先级就换优先队列。
4. **动态扩缩**：空闲线程多了要回收（否则线程栈本身占内存，默认 8MB/线程虚拟地址）；突发流量要扩容。
5. **异常**：任务抛异常必须捕获，否则线程函数抛出 → `terminate`。

```cpp
template <class F>
auto submit(F&& f) -> std::future<decltype(f())> {
    using R = decltype(f());
    auto task = std::make_shared<std::packaged_task<R()>>(std::forward<F>(f));
    auto fut = task->get_future();
    { std::lock_guard<std::mutex> lk(m_); q_.emplace_back([task]{ (*task)(); }); }
    cv_.notify_one();
    return fut;
}
```

**追问**：*线程数开多少？* CPU 密集型 ≈ `hardware_concurrency()`；IO 密集型可 2–4 倍；CV 推理要按 **GPU 数量**和显存来定（不是 CPU 核数），并且注意 CUDA 的 `cudaStream` 是异步的——提交任务不等于算完。

---

## Q33. `vector` 扩容机制？`reserve` 和 `resize` 的区别？★★☆ 高频

**参考答案**

`vector` 用**连续内存**，容量不够时：分配一块更大的新内存 → 把旧元素**移动/拷贝**过去 → 析构旧元素 → 释放旧内存。扩容倍数是 **〔实现相关〕**：libstdc++ / libc++ 通常是 **2 倍**，MSVC 是 **1.5 倍**。用倍数（而非 +1）是为了让 `push_back` 的**摊还复杂度 O(1)**。

```cpp
std::vector<int> v;
v.reserve(1000);    // 只改 capacity，不改 size，不构造元素
v.resize(1000);     // 改 size，真的构造 1000 个元素（值初始化）
```

| | 改变 size | 构造元素 | 能用 `[]` 访问 |
|---|---|---|---|
| `reserve(n)` | ❌ | ❌ | 越界，UB |
| `resize(n)` | ✅ | ✅ | ✅ |

**工程实践**：已知规模就 `reserve`（点云、候选框、检测结果列表）；频繁 `push_back` 大对象时确保移动构造是 `noexcept`（Q16）。

**追问**

- *`shrink_to_fit` 一定生效吗？* 不一定，非强制请求。
- *`vector<bool>` 有什么问题？* 特化版按位存储，`operator[]` 返回代理对象而非 `bool&`，不能取地址、不能和 `bool*` 互操作。要位图就用 `std::vector<uint8_t>` 或 `std::bitset`。

**出处**：<https://en.cppreference.com/w/cpp/container/vector/reserve>

---

## Q34. `map` 和 `unordered_map` 怎么选？哈希冲突怎么处理？★★☆

**参考答案**

| | `map` | `unordered_map` |
|---|---|---|
| 底层 | 红黑树（平衡 BST） | 哈希表（桶数组 + 链表/开放寻址） |
| 查找 | O(log n) | 均摊 O(1)，最坏 O(n) |
| 有序 | ✅ 按 key 排序 | ❌ |
| 迭代器稳定性 | 插入不失效 | rehash 时迭代器全部失效（但**引用/指针仍有效**） |
| 内存 | 每节点一个分配，开销大 | 桶数组连续 + 节点 |
| 适合 | 需要范围查询/有序遍历 | 纯查找，量大 |

**冲突处理**：标准库实现多用**链地址法**（bucket 挂链表，libstdc++ 是单链表 + 桶数组）。开放寻址（线性探测/罗宾汉哈希）缓存局部性更好，但删除要 tombstone——`absl::flat_hash_map`、`f14` 走这条路。

**工程实践**：key 是整数且范围有限时，用**数组/`std::vector` 直接索引**最快（CV 里类别 id → 颜色的映射就这么做）；key 是 string 时先用 `string_view` 或整数化（如 FNV/xxHash）避免重复构造。

**坑**：`unordered_map` 的 `operator[]` 会**默认构造** value（`m[k]` 插入默认值）；纯查询用 `find`/`contains`（C++20）。自定义类型做 key 要提供 `hash` 和 `operator==`。

**出处**：<https://en.cppreference.com/w/cpp/container/unordered_map>

---

# D. Python 基础与 OOP

## Q35. Python 的参数传递是值传递还是引用传递？★★☆ 高频

**参考答案**

两者都不是，准确说法是 **"传对象引用"（call by object reference / call by sharing）**：函数拿到的是**实参对象的引用**（名字绑定），而不是对象副本。

推论：
- **修改对象内容**（`lst.append`、`d[k]=v`）→ 调用方**可见**；
- **重新绑定名字**（`lst = [...]`、`x = 1`）→ 调用方**不可见**。

```python
def f(lst, n):
    lst.append(1)      # 影响外部
    n += 1             # 不影响外部（int 不可变，只是本地绑定新对象）
    lst = [9, 9]       # 不影响外部（本地重新绑定）

a = []; b = 0
f(a, b)
print(a, b)            # [1] 0
```

**追问**：*怎么能"按值传"？* 不可变对象天然如此；可变对象传 `copy.copy` / `copy.deepcopy`；或干脆用不可变数据结构（tuple、frozen dataclass）。

**出处**：<https://docs.python.org/3/reference/executionmodel.html>；<https://nedbatchelder.com/text/names.html>

---

## Q36. 可变默认参数的陷阱是怎么回事？★★★ 高频（几乎必问）

**参考答案**

默认值在**函数定义时求值一次**并绑定到函数对象上，之后每次调用共享同一个对象。

```python
def add(item, bucket=[]):        # 错
    bucket.append(item)
    return bucket

print(add(1))    # [1]
print(add(2))    # [1, 2]  ← 不是 [2]
```

标准修法：

```python
def add(item, bucket=None):
    if bucket is None:
        bucket = []
    bucket.append(item)
    return bucket
```

**原理**：`def` 执行时把 `[]` 求值成对象，存进 `__defaults__`；参数缺失时绑定这个对象。同理 `def f(x, d={})`、`def f(x, cfg=Config())` 都中招（后者更危险：配置对象被跨调用污染）。

**追问**

- *怎么在代码里发现这类问题？* `ruff` 的 `B006`、`flake8-bugbear` 会报 mutable default。
- *同样的坑还有哪些？* 类属性用可变对象（`class A: items = []` → 所有实例共享）；闭包里的 late binding（Q43）。

**出处**：<https://docs.python.org/3/reference/compound_stmts.html#function-definitions>（"Default parameter values are evaluated from left to right when the function definition is executed"）

---

## Q37. `is` 和 `==` 的区别？小整数缓存是怎么回事？★★☆

**参考答案**

- `==` 调 `__eq__`，比较**值**；
- `is` 比较**身份**（`id()`，即内存地址）。

```python
a = [1, 2]; b = [1, 2]
a == b      # True
a is b      # False

x = 256; y = 256
x is y      # True  ← 小整数缓存 [-5, 256]
x = 257; y = 257
x is y      # CPython 交互式下可能 True，脚本里通常 False（实现相关）
```

**小整数缓存**（CPython 实现细节，**不是语言规范**）：-5 到 256 的整数在启动时创建、全局复用；字符串有 intern 机制（标识符形式的字符串在编译期被驻留）。所以"`is` 对不可变值有时为 True"——**千万别依赖它**。

**正确答案**：判断值用 `==`；判断 `None`/`True`/`False` 用 `is`（单例语义 + 更快 + 不会被重载的 `__eq__` 坑）。

**追问**：*为什么 `if x == None` 不好？* `None` 是单例，用 `is` 语义更准；而且如果 `x` 是个重载了 `__eq__` 的 numpy 数组，`x == None` 会返回数组，`if` 会抛 `ValueError: truth value ambiguous`。

**出处**：<https://docs.python.org/3/reference/expressions.html#comparisons>

---

## Q38. 深拷贝和浅拷贝？`copy.copy` 和 `copy.deepcopy` 的区别？★★☆

**参考答案**

- **赋值** `b = a`：只增加一个名字，不复制对象。
- **浅拷贝** `copy.copy(a)` / `a[:]` / `list(a)` / `a.copy()`：新容器，但**元素还是原对象的引用**。
- **深拷贝** `copy.deepcopy(a)`：递归复制所有层级。

```python
import copy
a = [[1, 2], [3, 4]]
b = copy.copy(a);    b[0].append(9)    # a 也变了 → [[1,2,9],[3,4]]
c = copy.deepcopy(a); c[0].append(7)   # a 不受影响
```

`deepcopy` 用 memo 字典处理循环引用（否则无限递归）；可自定义 `__deepcopy__(self, memo)`。

**追问**

- *numpy 数组呢？* `arr.copy()` 是**深拷贝数据**；`arr.view()` 是共享内存的视图；`arr[:]` 也是视图（不是拷贝）。
- *PyTorch 的 `.clone()` vs `.detach()`？* `clone` 复制数据（新 tensor，仍在计算图里），`detach` 只共享存储但脱离计算图——这是专题二的重点。

**出处**：<https://docs.python.org/3/library/copy.html>

---

## Q39. GIL 是什么？为什么有它？它让多线程完全没用吗？★★★ 高频（必问）

**参考答案**

**GIL（Global Interpreter Lock）** 是 CPython 的一把**全局互斥锁**：任何时刻只有一个线程能执行 Python 字节码。它保护的是 CPython 解释器的内部状态（引用计数、对象分配），让实现变简单、单线程性能更好。

```text
时间轴（IO 密集型）
线程A ████████░░░░░░░░████████
线程B ░░░░████████░░░░░░░░████    ← 等待 IO 时不持 GIL，别的线程能跑
             ↑ IO 阻塞时释放 GIL
时间轴（CPU 密集型）
线程A ████████████████████████    ← 交替但总吞吐没提升，反而有切换开销
线程B (几乎跑不到)
```

**关键细节**：

1. **不是每行都抢锁**：切换间隔由 `sys.getswitchinterval()` 控制（默认 **5 ms**），不是每条字节码。
2. **阻塞式 IO 会释放 GIL**（`socket.recv`、`file.read`、`time.sleep`），所以 **IO 密集多线程依然有效**。
3. **C 扩展常主动释放 GIL**：NumPy 的大数组运算、OpenCV 的 `cv2` 调用（大部分）不持 GIL，因此**多线程跑 cv2 能真并行**。
4. **CPU 密集型**用 `multiprocessing`（多进程，各带 GIL）或把热点下移到 C++/CUDA。

**最新进展〔需注意版本〕**：PEP 703 引入 **free-threaded（no-GIL）CPython**，Python 3.13 起作为**实验性可选构建**提供，3.14 继续推进；默认构建仍是带 GIL 的。回答时点明"实验性、可选构建"才准确。

**追问**

- *GIL 存在是否意味着 Python 变量操作是线程安全的？* **不**。`x += 1` 是读-加-写三步，字节码级别可能被打断 → 需要 `threading.Lock`。GIL 只保证单条字节码的原子性。
- *怎么验证某操作有没有释放 GIL？* 计时：多线程跑同一任务，观察是否加速；或用 `sys.setswitchinterval` 调大观察变化。

**出处**：<https://docs.python.org/3/glossary.html#term-global-interpreter-lock>；<https://peps.python.org/pep-0703/>；<https://wiki.python.org/moin/GlobalInterpreterLock>

---

## Q40. `__new__` 和 `__init__` 的区别？单例怎么实现？★★☆

**参考答案**

- `__new__(cls, ...)`：**创建**实例（返回实例对象），是类方法（隐式静态），在 `__init__` 之前调用。
- `__init__(self, ...)`：**初始化**已创建的实例，返回 `None`。

`__new__` 的典型用途：不可变类型（`int`、`str`、`tuple`）的子类化、单例、对象池、`__slots__` 场景的定制创建。

```python
class Singleton:
    _inst = None
    def __new__(cls, *a, **kw):
        if cls._inst is None:
            cls._inst = super().__new__(cls)
        return cls._inst

# 更 Pythonic 的两种：
# 1) 模块级单例（推荐）：模块本身就是天然单例
# 2) 元类 / @functools.lru_cache 装饰工厂函数
```

**追问**

- *`__new__` 返回别的类型会怎样？* `__init__` 就不会被调用（因为不是本类实例）。
- *为什么 `tuple` 子类要用 `__new__`？* 因为 `tuple` 不可变，内容必须在创建时定好，`__init__` 阶段改不了。

**出处**：<https://docs.python.org/3/reference/datamodel.html#object.__new__>

---

## Q41. Python 的多继承和 MRO（C3 线性化）★★★

**参考答案**

Python 支持多继承，方法解析顺序由 **C3 线性化**算法确定，即 `Cls.__mro__`。规则可概括为：**子类优先于父类、同一层的父类按声明顺序、每个类只出现一次且保持局部优先序**。

```python
class A: pass
class B(A): pass
class C(A): pass
class D(B, C): pass

print(D.__mro__)
# (<class 'D'>, <class 'B'>, <class 'C'>, <class 'A'>, <class 'object'>)

#         A
#        / \
#       B   C
#        \ /
#         D      → D → B → C → A → object
```

`super()` 在 Python 3 里**不是"调用父类"**，而是"**沿 MRO 取下一个类**"：

```python
class A:
    def f(self): print("A")
class B(A):
    def f(self): print("B"); super().f()
class C(A):
    def f(self): print("C"); super().f()
class D(B, C):
    def f(self): print("D"); super().f()

D().f()      # D B C A  ← 顺序就是 MRO
```

这就是**协作式多继承（cooperative multiple inheritance）**：每个类只负责自己那层，用 `super()` 接力。

**追问**

- *C3 解决什么问题？* 旧式 DFS 在菱形继承下顺序不一致/不单调；C3 保证**单调性**和**局部优先序**。
- *MRO 冲突会怎样？* 类定义时直接抛 `TypeError: Cannot create a consistent method resolution order`。
- *什么时候该用多继承？* **混入（Mixin）**：单一职责的小类（`LoggingMixin`、`JSONSerializableMixin`），不要做"多重实现继承"。

**出处**：<https://docs.python.org/3/howto/mro.html>；<https://www.python.org/download/releases/2.3/mro/>

---

## Q42. `__slots__`、`property`、`classmethod`/`staticmethod` 各自解决什么？★★☆

**参考答案**

**`__slots__`**：用**固定槽位**替代 `__dict__`，每个实例省掉一个字典（约 100+ 字节）。在"百万级对象"（点、框、采样点）场景下内存差一个数量级。

```python
class Point:
    __slots__ = ("x", "y")      # 不能再动态加属性，也没有 __dict__
    def __init__(self, x, y): self.x, self.y = x, y
```

代价：不能动态加属性、不能被多继承（若多个基类都有非空 slots 会冲突）、默认不支持 `__weakref__`（要在 slots 里显式加）。

**`property`**：把方法伪装成属性，实现**受控访问**（校验、惰性计算、只读）。

```python
class Box:
    def __init__(self): self._w = 0
    @property
    def w(self): return self._w
    @w.setter
    def w(self, v):
        if v < 0: raise ValueError("w >= 0")
        self._w = v
```

**`classmethod` vs `staticmethod`**：前者第一个参数是 `cls`（可访问/创建子类 → 工厂方法、替代构造函数），后者只是"放在类命名空间里的普通函数"（无隐式参数）。

**追问**：*`@property` 和直接暴露属性有什么区别？* 加了 property 后仍可 `obj.w` 访问（语法不变），但能加校验和惰性求值；代价是没有 `__dict__` 那种极致的访问速度（property 是描述符，走 `__get__`）。

**出处**：<https://docs.python.org/3/reference/datamodel.html#slots>；<https://docs.python.org/3/library/functions.html#property>

---

## Q43. 闭包和循环变量延迟绑定（late binding）★★☆

**参考答案**

闭包捕获的是**变量（cell）**，不是**当时的值**。循环里创建的多个闭包共享同一个变量，等它们被调用时变量已经是循环结束后的值。

```python
funcs = [lambda: i for i in range(3)]
print([f() for f in funcs])      # [2, 2, 2]  ← 不是 [0, 1, 2]

# 修法一：默认参数（定义时求值）
funcs = [lambda i=i: i for i in range(3)]        # [0, 1, 2]
# 修法二：functools.partial
from functools import partial
funcs = [partial(lambda i: i, i) for i in range(3)]
# 修法三：再套一层工厂函数（新的 cell）
def make(i): return lambda: i
funcs = [make(i) for i in range(3)]
```

**注意**：是**闭包/嵌套函数**才有这个问题；`def` 里对 `i` 的赋值还会让 `i` 变成局部变量（`UnboundLocalError`），要用 `nonlocal`。

**追问**：*怎么查看闭包捕获了什么？* `fn.__closure__`（cell 元组）、`fn.__code__.co_freevars`。

**出处**：<https://docs.python.org/3/faq/programming.html#why-do-lambdas-defined-in-a-loop-with-different-values-all-return-the-same-result>

---

## Q44. `list`、`dict`、`set` 的底层实现与复杂度？★★☆

**参考答案**

| 类型 | 底层 | 索引 | 查找 | 插入/删除 | 有序 |
|---|---|---|---|---|---|
| `list` | 动态数组（`PyObject**` 连续块，**存指针**） | O(1) | O(n) | 尾部均摊 O(1)，中间 O(n) | 按插入 |
| `tuple` | 静态数组 | O(1) | O(n) | 不可变 | ✅ |
| `dict` | 哈希表（3.6+ **compact dict**：索引数组 + 条目数组） | — | 均摊 O(1) | 均摊 O(1) | **3.7+ 保证插入顺序**（语言规范） |
| `set` | 哈希表（同 dict 的 key 部分） | — | 均摊 O(1) | 均摊 O(1) | ❌ |

**要点**：

- `list` 存的是**对象指针**（不是值），所以 `[1, 2.5, "a"]` 合法，但缓存局部性差——**大数据要用 `array`/`numpy`**。
- `dict` 的 key 必须**可哈希**（不可变且 `__hash__` 稳定）；`list` 不能当 key，`tuple`（元素都可哈希）可以。
- 3.7 起 dict **保证**插入顺序（3.6 是实现细节）。

**追问**：*为什么 dict 的 key 要可哈希？* 哈希表靠 hash 定位桶，若对象可变则哈希会变，导致找不到；所以 `__hash__` 与 `__eq__` 要一致。

**出处**：<https://docs.python.org/3/tutorial/datastructures.html>；<https://docs.python.org/3/reference/datamodel.html#object.__hash__>；CPython `dictobject.c` 注释。

---

## Q45. 列表推导式、生成器表达式、`map` 的性能与选择？★★☆

**参考答案**

| | 求值 | 内存 | 速度 |
|---|---|---|---|
| `[f(x) for x in it]` | 立即 | O(n) | 最快（C 层 `LIST_APPEND`） |
| `(f(x) for x in it)` | 惰性 | O(1) | 略慢于列表推导（每项有生成器开销），但省内存 |
| `map(f, it)` | 惰性 | O(1) | 当 `f` 是**内置 C 函数**时最快；是 Python 函数时不如推导式 |

**结论**：要成品列表 → 推导式；只要遍历一次/数据大 → 生成器表达式；配合 `sum/min/max/any/all` 的短路 → 生成器表达式；`numpy` 场景下**都别用**，用向量化。

```python
sum(x*x for x in range(10**7))     # 内存 O(1)
[x*x for x in range(10**7)]        # 内存 ~几百 MB（指针数组）
```

**追问**：*推导式的变量作用域？* Python 3 中推导式有**独立作用域**（不会泄漏到外层），这点和 Python 2 不同。

**出处**：<https://docs.python.org/3/tutorial/datastructures.html#list-comprehensions>

---

# E. Python 高阶与工程

## Q46. 装饰器的原理？写一个带参数的装饰器。★★★ 高频（必问）

**参考答案**

装饰器本质是**接受函数、返回函数的高阶函数**，`@deco` 等价于 `f = deco(f)`。

```python
import functools, time

def timer(func):                      # 不带参：两层
    @functools.wraps(func)
    def wrapper(*args, **kwargs):
        t0 = time.perf_counter()
        try:
            return func(*args, **kwargs)
        finally:
            print(f"{func.__name__} {time.perf_counter()-t0:.4f}s")
    return wrapper

def retry(times=3, delay=0.1):        # 带参：三层
    def deco(func):
        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            for i in range(times):
                try:
                    return func(*args, **kwargs)
                except Exception:
                    if i == times - 1: raise
                    time.sleep(delay)
        return wrapper
    return deco

@retry(times=5, delay=0.2)
def infer(img): ...
```

```text
@deco                    f = deco(f)
两层结构：                    三层结构（带参）：
  deco(func)                   retry(times)(func)
     └─ wrapper                   └─ deco(func) → wrapper
```

**`functools.wraps` 的作用**：把 `__name__`、`__doc__`、`__module__`、`__qualname__`、`__dict__`、`__wrapped__` 复制过去，否则被装饰函数的元信息全变成 `wrapper`（影响日志、`help()`、pytest 收集、`inspect.signature`）。

**追问**

- *多个装饰器的执行顺序？* 自**下而上**包装、自**上而下**执行：

  ```python
  @A
  @B
  def f(): ...
  # 等价于 f = A(B(f))，调用时先进入 A 的 wrapper，再到 B
  ```
- *类装饰器和装饰类？* 装饰器可以是类（实现 `__call__`）；也可以用装饰器装饰类（修改/替换类，如 `@dataclass`、`@register_model`）。
- *怎么让装饰器同时支持"带参/不带参"？* 判断第一个参数是否 callable（`if callable(arg)`）。
- *CV 工程里的实际用法*：`@torch.no_grad()`、`@lru_cache`（编译正则、加载标定参数）、`@timer`（测每步耗时）、`@retry`（读相机/网络重试）。

**出处**：<https://docs.python.org/3/glossary.html#term-decorator>；<https://peps.python.org/pep-0318/>

---

## Q47. 生成器是干什么的？`yield` 的执行流程？`yield from` 有什么用？★★★

**参考答案**

生成器是**惰性求值的迭代器**：函数体内出现 `yield` 就把函数变成生成器函数，调用它不执行函数体，而是返回一个生成器对象；每次 `next()` 执行到下一个 `yield` 并**挂起**（保留局部变量和指令指针）。

```python
def batch_loader(items, size):
    for i in range(0, len(items), size):
        yield items[i:i+size]        # 每 yield 一次就交出控制权，状态保留

for b in batch_loader(range(10), 3):
    print(b)                         # [0,1,2] [3,4,5] [6,7,8] [9]
```

```text
调用 gen()        → 返回生成器对象（函数体未执行）
next(gen)         → 执行到 yield，返回值，挂起（状态保存）
next(gen)         → 从挂起处继续
StopIteration     → 函数体结束
gen.send(v)       → 从挂起处继续，把 v 作为 yield 表达式的值
gen.throw(E)      → 在挂起点抛出异常
gen.close()       → 抛 GeneratorExit，触发 finally
```

**`yield from sub`**（PEP 380）：把 `send`/`throw`/`close` 转发给子生成器，并**返回子生成器的 `return` 值**。它能把生成器"扁平化"：

```python
def chain(*its):
    for it in its:
        yield from it        # 替代 for x in it: yield x，还能拿到返回值
```

**工程价值**：PyTorch 的 `DataLoader` 就是迭代器协议；流式读取大文件、流式推理（逐帧 yield）都能把内存压到 O(1)。

**追问**

- *生成器能重复遍历吗？* 不能，**一次性**（遍历完就空）。要多次遍历用列表或重新创建。
- *生成器和迭代器的区别？* 生成器是"用 yield 写出来的迭代器"，是最省事的实现方式。
- *生成器里的 `finally` 什么时候执行？* 正常结束、异常、`close()`、被 GC 回收时（CPython 引用计数下及时）。

**出处**：<https://docs.python.org/3/reference/expressions.html#yieldexpr>；<https://peps.python.org/pep-0380/>

---

## Q48. 上下文管理器 `with` 的原理？写一个。★★☆

**参考答案**

`with` 调用对象的 `__enter__`（返回值绑定到 `as` 后面的名字），退出时调 `__exit__(exc_type, exc_val, tb)`；`__exit__` 返回 **True** 会**吞掉异常**，返回 False/None 则异常继续传播。

```python
class Timer:
    def __enter__(self):
        self.t0 = time.perf_counter()
        return self
    def __exit__(self, et, ev, tb):
        print(f"cost {time.perf_counter()-self.t0:.3f}s")
        return False          # 不吞异常

with Timer() as t:
    run_inference()
```

**`contextlib.contextmanager` 版本**（更常用，少写一个类）：

```python
from contextlib import contextmanager

@contextmanager
def cuda_autocast():
    old = torch.is_autocast_enabled()
    torch.set_autocast_enabled(True)
    try:
        yield
    finally:
        torch.set_autocast_enabled(old)     # 必须放 finally，保证异常也能恢复
```

**关键点**：`yield` **之前**是 `__enter__`，`yield` **之后**（必须在 `try/finally` 里）是 `__exit__`；异常会在 `yield` 处抛进生成器，`finally` 保证清理。

**追问**

- *`with` 能同时开多个吗？* `with open(a) as f, open(b) as g:`（等价嵌套）。
- *异步上下文管理器？* `async with` + `__aenter__/__aexit__`，`@contextlib.asynccontextmanager`。
- *`__exit__` 里抛异常会怎样？* 替换原异常（原异常作为 `__context__` 保留）。

**出处**：<https://docs.python.org/3/reference/compound_stmts.html#the-with-statement>；<https://peps.python.org/pep-0343/>

---

## Q49. 多线程、多进程、协程怎么选？★★★ 高频

**参考答案**

| | 适用 | 原因 | 代价 |
|---|---|---|---|
| **多线程** | IO 密集（等网络/磁盘/相机）、**调用释放 GIL 的 C 扩展**（NumPy、OpenCV、CUDA） | IO 阻塞时释放 GIL | 切换开销、共享状态要加锁 |
| **多进程** | CPU 密集的纯 Python 计算 | 每个进程独立 GIL | 启动慢、内存翻倍、进程间要序列化（pickle） |
| **asyncio 协程** | **海量**并发连接/异步 IO（几万连接） | 单线程事件循环，无切换开销 | 整条链路必须 async；CPU 计算会阻塞整个循环 |

```python
# 多进程：绕过 GIL 做 CPU 密集
from concurrent.futures import ProcessPoolExecutor
with ProcessPoolExecutor() as ex:
    results = list(ex.map(heavy_cpu_func, data))

# 协程：海量 IO
async def fetch_all(urls):
    async with aiohttp.ClientSession() as s:
        return await asyncio.gather(*(fetch(s, u) for u in urls))
```

**CV/工业检测的实际组合**：**采集线程**（cv2 取图，C 层释放 GIL）→ **队列** → **推理**（GPU，Python 层几乎不占 CPU）→ **后处理（numpy 向量化，释放 GIL）**；训练数据加载用 `DataLoader(num_workers>0)` 多进程。纯 Python 的后处理是瓶颈时才考虑多进程或 C++ 下沉。

**追问**：*`asyncio` 里能直接调阻塞函数吗？* 不能，会卡死事件循环；用 `loop.run_in_executor` 或 `asyncio.to_thread`。

**出处**：<https://docs.python.org/3/library/asyncio.html>；<https://docs.python.org/3/library/concurrent.futures.html>

---

## Q50. `try/except/finally` 里 `return` 会发生什么？异常处理的坑有哪些？★★☆

**参考答案**

`finally` **一定会执行**（即使 `try` 里有 `return`）；而且 **`finally` 里的 `return` 会覆盖 `try` 里的返回值，并吞掉正在传播的异常**。

```python
def f():
    try:
        return 1
    finally:
        return 2         # 返回值变成 2
print(f())               # 2

def g():
    try:
        raise ValueError
    finally:
        return 0         # 异常被吞掉，返回 0
print(g())               # 0，ValueError 消失
```

**其他坑**：`except Exception` 太宽（会吞掉 `KeyboardInterrupt` 之外的逻辑错误）；`except: pass` 掩盖 bug；异常里带大对象（traceback 持有帧引用 → 内存泄漏，Python 3 已用 `__traceback__` 循环引用 + GC 缓解）；`raise` 与 `raise e` 的区别（后者重置 traceback）。

**最佳实践**：`except` 尽量窄；用 `else` 放"没异常时才执行"的代码；清理逻辑放 `finally` 或 `with`；需要重抛就裸 `raise`。

**追问**：*`except (A, B) as e` 里 e 在块结束后会被删掉吗？* 会被 `del`（防止循环引用），块外访问会 `NameError`。

**出处**：<https://docs.python.org/3/reference/compound_stmts.html#the-try-statement>

---

## Q51. 类型注解有什么用？`Optional`、`Protocol`、`TypeVar` 怎么用？★★☆

**参考答案**

Python 是动态类型，注解**不影响运行**（只在 `__annotations__` 里留个记录），价值在于：IDE 补全、静态检查（mypy/pyright）、文档化接口、以及 dataclass/pydantic 的元编程。

```python
from typing import Optional, Protocol, TypeVar, Iterable

T = TypeVar("T")

def first(items: Iterable[T], default: Optional[T] = None) -> Optional[T]:
    return next(iter(items), default)

class Detector(Protocol):                  # 结构化子类型：不看继承，只看有没有这个方法
    def predict(self, img: "np.ndarray") -> list[dict]: ...

def run(d: Detector) -> None: ...          # 任何有 predict 的对象都能传进来
```

**关键点**：`Optional[X]` 就是 `Union[X, None]`（**Swift 那样的 Optional 不存在**）；`Protocol` 是"鸭子类型的静态化"，很适合给第三方对象（如 `torch.nn.Module`）做接口约束。

**坑**：`list[int]` 这种内置泛型要 Python **3.9+**；`X | None` 要 **3.10+**；`from __future__ import annotations` 可以把注解延迟求值（解决前向引用和启动开销）。

**出处**：<https://peps.python.org/pep-0484/>；<https://peps.python.org/pep-0544/>

---

## Q52. 工程里最常见的 Python 性能/正确性坑，能列几个吗？★★☆（工程感加分题）

**参考答案**

**正确性**

1. 可变默认参数（Q36）。
2. `is` 比字符串/数字（Q37）——偶尔为 True 让你以为行，换环境就崩。
3. 循环里 `import`（虽然被缓存，但查表有开销，也可能造成循环导入）。
4. 浮点数比较用 `==`：用 `math.isclose` / `np.allclose`。
5. 修改正在遍历的 list/dict（迭代器失效，Python 会抛 `RuntimeError` 或静默错）。
6. `datetime.now()` 不带时区；跨时区/序列化要用 `timezone.utc`。
7. 可变对象做 dict key（`__hash__` 变了就找不到）。
8. 多线程共享 `+=` 计数（GIL 不保证复合操作原子，Q39）。
9. 循环导入：用局部 import 或重构依赖方向。
10. `except Exception: pass` 掩盖真实错误。

**性能**

1. **用 numpy 向量化**替代 Python 循环（差 10–100 倍，这是 CV 场景的头号原则）。
2. 字符串拼接用 `"".join(list)`，不要在循环里 `+=`。
3. 热点函数内**用局部变量**（`append = lst.append`）。
4. 用 `@lru_cache` 缓存纯函数（参数可哈希时）。
5. 大数据别用 `list`，用 `array`/`numpy`/`bytearray`。
6. 用 `cProfile` + `line_profiler` 先定位再优化，不要凭感觉。

**追问**：*怎么定位 Python 的热点？* `python -m cProfile -s cumtime script.py`、`py-spy`（能 attach 到运行中的进程，CV 服务排障常用）、`line_profiler`。

---

# F. 快问快答（45 题）

> 一题一行结论，面试前扫读用。要展开看细节，回 A–E 对应章节。

**Q53** `const` 成员函数里能改成员吗？ —— 不能，除了 `mutable` 成员（常用于缓存、互斥锁、统计计数）。

**Q54** 四种 `cast` 怎么选？ —— `static_cast`（编译期可判的转换，最常用）、`dynamic_cast`（多态类型的安全向下转换，**有 RTTI 开销**）、`const_cast`（去 const，**改真正的 const 对象是 UB**）、`reinterpret_cast`（按位重解释，最危险）。**优先用 `static_cast`，避免 C 风格强转**。

**Q55** `sizeof` 引用得到什么？ —— 被引用类型的大小。引用**不是对象**，没有自己的大小，`sizeof(int&) == sizeof(int)`。

**Q56** `vector::clear()` 会释放内存吗？ —— **不会**，`size` 归 0 但 `capacity` 不变。要真释放用 `shrink_to_fit()`（非强制）或 `vector<T>().swap(v)`（经典写法）。

**Q57** `emplace_back` 一定比 `push_back` 快吗？ —— 不一定。它**就地构造**，省一次移动/拷贝；但如果传入的已经是同类型对象，两者等价。传构造参数（`emplace_back(a, b)`）才体现优势。

**Q58** `std::string` 的 SSO 是什么？ —— 短字符串优化：把 ≤15 字符（libstdc++，**实现相关**）直接存在对象内部的缓冲里，不分配堆内存。所以 `sizeof(std::string)` 是 32 字节而不是 8。

**Q59** `std::move` 一个 `std::string` 之后，原对象还能用吗？ —— 能，处于"**有效但未指定**"状态（libstdc++ 里通常是空串）。可以析构、可以重新赋值，**但不要读它的值**。

**Q60** `reserve(n)` 之后 `push_back` 还会让迭代器失效吗？ —— 只要不超过 capacity 就**不会**。这也是"预先 reserve 再批量填充"能提升性能的原因（无扩容、无搬家）。

**Q61** `std::optional` 解决什么？ —— 表达"可能没有值"且不用指针/魔法值（如返回 -1 表示失败）。比 `unique_ptr` 轻（无堆分配），比 `pair<bool,T>` 清晰。

**Q62** `std::variant` 和 `std::any` 的区别？ —— `variant` 是**类型安全的联合体**（候选类型编译期确定，用 `std::visit` 分发）；`any` 是**任意类型**的容器（运行时才知道，取值要 `any_cast`）。`variant` 更常用（状态机、参数值）。

**Q63** 结构化绑定（structured bindings）能用在哪些地方？ —— `std::tuple`/`std::pair`、`std::array`、聚合体（纯数据 struct）。`auto [k, v] = map_entry;` ——注意**按值会拷贝**，要引用写 `auto& [k, v]`。

**Q64** `if constexpr` 和普通 `if` 的区别？ —— 前者在**编译期**选择分支，**未选中的分支不实例化**（可以写只在某些类型下合法的代码）；后者两个分支都要能编译。

**Q65** C++17 的 `inline` 变量解决什么？ —— 允许在头文件里**定义**全局变量/类静态成员而不会多重定义（之前只能靠 `static` 或函数内 static 绕）。

**Q66** `std::string_view` 有什么坑？ —— 它**不拥有数据**，只是个指针+长度。指向临时字符串、或原字符串被修改/销毁后就**悬垂**（UB）。函数参数用它很好，**成员变量里存它要极其小心**。

**Q67** `std::span` 是干什么的？ —— C++20 的"非拥有连续序列视图"（指针+长度），用于替代 `(T* ptr, size_t n)` 这种成对参数，能统一接受数组/vector/`array`。

**Q68** `concept` 相比 SFINAE 好在哪？ —— 约束写在签名里、**报错可读**、可组合（`requires`）、支持重载排序。SFINAE 的 `enable_if` 报错信息几乎不可读。

**Q69** `thread_local` 的用途？ —— 每个线程一份独立副本（如线程私有缓存、随机数引擎、错误码）。注意：**动态库里的 `thread_local` 在部分平台有析构顺序问题**。

**Q70** `std::future` 调用 `get()` 之后还能再调吗？ —— 不能，`get()` 后 `valid() == false`（值被移走了）。要多次读就自己存下来。

**Q71** `lock_guard` 能提前解锁吗？ —— **不能**，它的接口只有构造和析构。需要中途解锁就用 `unique_lock`。

**Q72** `std::mutex` 能拷贝吗？ —— 不能拷贝也不能移动（它代表一个不可复制的 OS 资源）。所以含 mutex 的类默认不可拷贝——这往往是好事。

**Q73** `unique_ptr` 作为函数参数怎么传才能转移所有权？ —— **按值传**：`void take(std::unique_ptr<T> p)`，调用方必须 `std::move`。按 `const&` 传表示"只借用"。

**Q74** `weak_ptr` 为什么推荐 `lock()` 而不是先 `expired()` 再解引用？ —— `expired()` 和后续访问之间对象可能已被销毁（**竞态**）；`lock()` 是原子的，成功则拿到一个延长了生命周期的 `shared_ptr`。

**Q75** 多继承下，派生类指针转成不同基类指针，地址会变吗？ —— **会**。不同基类子对象在派生类里的偏移不同，编译器会做**指针调整**（thunk）。所以别拿 `reinterpret_cast` 在类层次间乱转。

**Q76** 虚继承解决什么问题？ —— 菱形继承下**共享唯一一份虚基类子对象**（避免二义性和数据重复）。代价是访问虚基类成员要走一次间接寻址。

**Q77** 纯虚函数可以有实现吗？ —— **可以**（`virtual void f() = 0;` 再加类外定义），派生类可以显式调用 `Base::f()`。常用于"纯虚析构"。

**Q78** `friend` 会被继承或传递吗？ —— 都不会。友元关系**不继承、不传递**，只是单向的"允许访问私有成员"。

**Q79** C++17 的"保证拷贝省略"是什么？ —— 用纯右值初始化对象时，**必须**直接在目标位置构造（`T x = T();` 不调用拷贝/移动构造）。这意味着**拷贝构造可以有副作用也不会被调用**——所以别在拷贝构造里写逻辑。

**Q80** 对空的 `std::function` 调用会怎样？ —— 抛 `std::bad_function_call`（不是崩溃）。所以调用前要么判空，要么保证已赋值。

**Q81** `std::bind` 和 lambda 怎么选？ —— **优先 lambda**：可读、可内联、能捕获引用/移动。`bind` 的占位符 `_1` 可读性差，且嵌套 bind 行为容易反直觉。

**Q82** CRTP 是什么、干什么用？ —— `class D : public Base<D>`，基类通过 `static_cast<D*>(this)` 调派生类实现，实现**编译期多态**（无虚表开销）。用于 mixin、计数器、`enable_shared_from_this`。

**Q83** 模板特化和函数重载怎么选？ —— 重载参与正常的重载决议（更直观）；特化只对特定类型替换实现（容易踩"特化不参与重载决议"的坑）。**能重载就重载**。

**Q84** ODR 是什么？违反了会怎样？ —— 单一定义规则：一个实体在整个程序里只能有一个定义（inline 函数/模板/类可以在多个 TU 出现但必须**完全一致**）。违反是 **UB**，常见表现是"链接时报重复符号"或"某个 TU 用了旧版本，行为诡异"。

**Q85** 为什么改了类的成员变量，所有用到它的文件都要重编译？ —— 因为**对象布局（ABI）变了**：`sizeof`、成员偏移、内联函数的代码都依赖布局。这也是 Pimpl 惯用法存在的原因（把实现藏进指针，改实现不动头文件）。

**Q86** `c_str()` 返回的指针能存起来长期用吗？ —— 不能。它在字符串**被修改或销毁**后失效。要长期持有就 `std::string` 拷贝一份。

**Q87** `std::vector<bool>` 有什么问题？ —— 它被特化成**按位存储**，`operator[]` 返回代理对象而非 `bool&`：不能取地址、不能传给 `bool*`、`data()` 不可用。要位图用 `vector<uint8_t>` 或 `bitset`。

**Q88** `list.append` 和 `list += ` 有什么区别？ —— `append` 加**一个元素**；`+=`（即 `extend`）把**可迭代对象的元素逐个加入**。`lst += "abc"` 会加进三个字符。

**Q89** `dict.get(k)` 和 `d[k]` 的区别？ —— 前者缺失返回 `None`（或指定默认值），后者抛 `KeyError`。要区分"没有这个键"和"值是 None"，用 `in` 或 `get(k, sentinel)`。

**Q90** `namedtuple` 和 `dataclass` 怎么选？ —— `namedtuple` 是**不可变元组**（可解包、可当 tuple 用、省内存）；`dataclass` 是普通类（可加方法、可继承、可 `frozen=True` 变不可变、3.10 起支持 `slots=True`）。要"轻量记录"用前者，要"有行为的对象"用后者。

**Q91** `@dataclass(slots=True)` 有什么好处？ —— 省内存（无 `__dict__`）、属性访问更快；代价是不能动态加属性。C++ 背景的人会喜欢它——行为更像结构体。

**Q92** 生成器和协程是一回事吗？ —— 不是。生成器是"用 `yield` 产出值"；协程（`async def`）是"用 `await` **挂起等待**"，由事件循环驱动。不过底层都用同一个机制（挂起/恢复栈帧），`yield` 也算一种协程。

**Q93** `asyncio` 能加速 CPU 密集任务吗？ —— **不能**。它只是让 IO 等待期间去跑别的任务，**计算本身仍占着 GIL 和单核**。CPU 密集要么多进程，要么把热点下移到 C/C++/numpy。

**Q94** `__repr__` 和 `__str__` 的区别？ —— `repr` 面向**开发者**（尽量无歧义、最好能 eval 回来），`str` 面向**用户**（可读）。只定义一个时，`repr` 优先（`print` 会退回用 `repr`）。

**Q95** 定义了 `__eq__` 之后为什么 `__hash__` 变成 None？ —— 因为相等的对象必须有相同的 hash；Python 不敢替你猜，所以**默认把类变成不可哈希**（不能放进 set/dict key）。要可哈希就显式定义 `__hash__`（通常 hash 参与比较的字段元组）。

**Q96** `__getattr__` 和 `__getattribute__` 的区别？ —— 前者只在**正常属性查找失败后**调用（适合做代理/懒加载）；后者**拦截所有**属性访问（容易写出无限递归，且拖慢一切）。

**Q97** `isinstance` 和 `type` 的区别？ —— `isinstance` 考虑**继承链**（子类实例返回 True）；`type(x) is C` 是精确匹配。判断类型优先用 `isinstance`。

# G. 深挖题（6 题）

## Q98. 手写一个无锁队列的核心：CAS 怎么用？ABA 问题是什么？★★★

**参考答案**

**CAS（compare-and-swap）**：`atomic<T>::compare_exchange_weak(expected, desired)` —— 如果当前值等于 `expected` 就写入 `desired` 并返回 true；否则把 `expected` 更新成当前值并返回 false。

```cpp
struct Node { int v; Node* next; };

std::atomic<Node*> head{nullptr};

void push(int v) {
    Node* n = new Node{v, head.load(std::memory_order_relaxed)};
    // 失败时 n->next 已经被 CAS 更新成"最新的 head"，直接重试即可
    while (!head.compare_exchange_weak(n->next, n,
                                       std::memory_order_release,   // 成功：发布
                                       std::memory_order_relaxed))  // 失败：只需重读
    {}
}

bool pop(int& out) {
    Node* old = head.load(std::memory_order_acquire);
    while (old && !head.compare_exchange_weak(old, old->next,
                                              std::memory_order_acquire,
                                              std::memory_order_acquire))
    {}
    if (!old) return false;
    out = old->v;
    delete old;              // ← 危险：别的线程可能还在读它
    return true;
}
```

```text
ABA 问题：
  线程1 读到 head = A，准备 CAS(A → C)
  线程2 抢先 pop 了 A、push 回来一个"地址相同的新 A"
  线程1 的 CAS 成功（地址还是 A），但 next 已经不同 → 链表断裂/丢数据
```

**三种解法**：

1. **带版本号的指针**（`atomic<uint64_t>` 打包指针+计数器，或用 `std::atomic<PtrWithTag>` 的 128 位 CAS）；
2. **延迟回收**（hazard pointer / epoch-based reclamation）——顺带解决 `delete old` 的悬垂问题；
3. **不在无锁结构里回收内存**（节点回收交给安全点）。

**追问**：*为什么 `push` 里失败时不用重置 `n->next`？* 因为 `compare_exchange_weak` 失败时会把 `n->next` 更新成**当前的 head**，正好是下一次重试需要的值——这是无锁 push 的经典写法。

**要说的边界**：无锁队列在**高争用**下不一定比 `mutex + 条件变量` 快，且正确性极难验证。工程上优先用成熟实现（`moodycamel::ConcurrentQueue`、`boost::lockfree`），**自己写只在"必须无阻塞"的场景**。

---

## Q99. C++ 的类型擦除怎么实现？`std::function` 内部到底装了什么？★★★

**参考答案**

**类型擦除** = 把"具体类型"藏起来，只保留**公共接口**，让不同的类型能放在同一个容器/参数里。

**三种实现层次**：

```cpp
// ① 虚函数（最经典）
struct Callable { virtual ~Callable() = default; virtual void call() = 0; };
template <class F> struct Model : Callable {
    F f; explicit Model(F f_) : f(std::move(f_)) {}
    void call() override { f(); }
};
// ② 函数指针 + void*（C 风格）
// ③ SBO（小对象优化）：小于缓冲区的就地存，否则堆分配
```

`std::function` 内部就是 ①+③ 的组合：

```text
std::function<void(int)> 的内存布局（libstdc++ 典型）
+---------------------------------------+
| 管理函数指针（invoke/clone/destroy）    |  ← vtable 式的类型擦除
| 存储区（SBO，通常 16 字节）             |  ← 小 lambda 就地存，大的 heap 分配
+---------------------------------------+
```

**代价**：

1. **间接调用**：`invoke` 通过函数指针跳转，**无法内联**；
2. **可能堆分配**：捕获超过 16 字节（比如捕获两个 shared_ptr）就 `new`；
3. **拷贝语义**：`std::function` 要求可拷贝 → 装不进 `unique_ptr`（C++23 的 `std::move_only_function` 才解决）。

**工程判断**：热路径（每像素回调）用模板/函数指针，接口边界用 `std::function`，只读引用用自己写的 `function_ref`（不拥有、零分配）。

**追问**：*`std::variant` 是类型擦除吗？* 不算——它**保留**类型信息（`index()`/`visit` 能恢复），是"类型安全的联合体"。真正的类型擦除是 `any`（连类型都只剩运行时记录）。

---

## Q100. 编译、链接和 ODR：为什么"头文件里定义函数"会报重复符号？★★☆

**参考答案**

**四个阶段**：预处理（展开 `#include`/宏）→ 编译（每个 `.cpp` 单独生成 `.o`）→ 汇编 → 链接（合并 `.o`，解析外部符号）。

```text
a.cpp ──预处理──► a.i ──编译──► a.o ─┐
b.cpp ──预处理──► b.i ──编译──► b.o ─┼──链接──► prog
c.cpp ──预处理──► c.i ──编译──► c.o ─┘   （解析 undefined / 多重定义）
```

**为什么头文件里定义普通函数会重复**：`#include` 是**文本复制**，每个 `.cpp` 都得到一份定义 → 链接时两个 `.o` 都有 `foo` 的强符号 → **重复定义**（链接错误）。

**三种正解**：

| 方式 | 机制 | 注意 |
|---|---|---|
| `inline` | 允许**多个相同定义**，链接器选一个 | 所有定义必须**逐字符一致**（否则 UB） |
| `static` | 每个 TU 一份**内部链接**副本 | 每个 TU 各一份，**代码膨胀 + 地址不同**（别拿来比较函数指针） |
| 放 `.cpp` + 头文件只声明 | 唯一一份定义 | 最经典，但失去内联 |

**类内定义成员函数为什么不用写 inline？** 因为类定义里的函数**隐式 inline**。

**模板为什么可以放头文件？** 模板**不是**定义（是"生成定义的配方"），实例化出来的才是；不同 TU 实例化的同一模板通过 `inline`/弱符号机制合并。

**ODR 违反的隐蔽危害**：两个 TU 里同一个 `inline` 函数**定义不一致**（比如一个开了 `-DNDEBUG` 一个没开）→ 链接器随机选一个 → 行为不可预测，而且**换个编译顺序就变**。这是"只在 Release 崩"类 bug 的常见根因。

**追问**：*静态库和动态库的区别？* 静态库（`.a/.lib`）在链接期把目标代码**复制进可执行文件**；动态库（`.so/.dll`）运行时加载，多个进程共享一份代码。C++ 里跨动态库边界传对象要特别小心 **ABI 一致性**（编译器版本、STL 实现、`_GLIBCXX_USE_CXX11_ABI` 都必须一致）。

---

## Q101. Python 生成器的内部实现：`send`、`throw`、`close` 到底在操作什么？★★★

**参考答案**

生成器对象内部持有一个**栈帧（frame）**，`yield` 的语义是"**保存当前帧、把控制权交回调用方**"。

```text
gen = f()        → 创建 frame，不执行
next(gen)        → 执行到 yield，返回值，帧挂起（局部变量、指令指针都保留）
gen.send(v)      → 恢复执行，v 成为 yield 表达式的值
gen.throw(E)     → 在挂起点抛出 E（生成器内部可 try/except 捕获）
gen.close()      → 在挂起点抛 GeneratorExit（生成器应清理并退出）
```

```python
def echo():
    while True:
        try:
            x = yield              # ← yield 的值 = send 进来的参数
            print("got", x)
        except ValueError:
            print("bad value")
        except GeneratorExit:
            print("closing"); raise     # 必须重新抛出，否则 RuntimeError

g = echo(); next(g)          # 预激活到第一个 yield
g.send(42)                   # got 42
g.throw(ValueError())        # bad value
g.close()                    # closing
```

**三个必须知道的细节**：

1. **必须先 `next` 或 `send(None)` 预激活**——刚创建的生成器停在函数开头，直接 `send(非 None)` 会报 `TypeError`。这个"预激活"正是 `@contextmanager` 和 `asyncio` 内部要做的事。
2. **`close()` 后生成器不能再用**（`StopIteration`）；`GeneratorExit` 不能被 `yield`（会 `RuntimeError: generator ignored GeneratorExit`）。
3. **`yield from` 会自动转发** `send`/`throw`/`close` 给子生成器，并返回子生成器的 `return` 值——这是手写"生成器委托"的标准做法（PEP 380）。

**和协程的关系**：`async def` 编译出来的也是"可挂起的帧"，`await` 本质是"`yield` 一个 future 并等待它完成"。所以**生成器是协程的前身**（早期 `@asyncio.coroutine` + `yield from` 就是协程）。

**追问**：*怎么查看生成器内部状态？* `gen.gi_frame`（当前帧，运行中为 None）、`gen.gi_frame.f_locals`、`gen.gi_code`、`inspect.getgeneratorstate()`（GEN_CREATED/GEN_RUNNING/GEN_SUSPENDED/GEN_CLOSED）。

---

## Q102. Python 的内存管理与 GC：引用计数和分代回收怎么配合？★★★

**参考答案**

**两层机制**：

```text
① 引用计数（主力）：每个对象有 ob_refcnt，引用 ±1 时更新，归 0 立刻释放
   ✓ 及时（不需要等 GC）、实现简单
   ✗ 无法处理循环引用；计数操作有开销；不解决"内存碎片"

② 分代回收（补充）：专门找"循环垃圾"
   把对象分成 3 代（0/1/2），新对象在 0 代
   0 代满了（阈值 700）→ 扫描 0 代，存活对象晋升到 1 代
   1 代满了（10 次）→ 扫 1 代 … 2 代（10 次）
   ✓ 大部分对象朝生夕死，只扫新生代就行（分代假设）
```

```python
import gc
gc.get_threshold()      # (700, 10, 10) 默认阈值
gc.collect()            # 手动全量回收（调试内存泄漏时用）
gc.get_objects()        # 所有被 GC 跟踪的对象（排查用，注意很慢）
```

**循环引用的破解**：GC 用**标记-清除**的变体（从根可达性分析），能识别"互相引用但外部不可达"的环。**注意：只含不可变类型（int/str/tuple）的对象不参与循环 GC**（它们不可能构成环）。

**`__del__` 的坑**：定义了 `__del__` 的对象在 Python 3.4 之前**无法被 GC 回收**（会被放进 `gc.garbage`）；现在可以回收，但顺序不确定，**不要在 `__del__` 里做重要清理**——用 `with`/`finally` 显式管理。

**排查内存泄漏的顺序**（CV 服务里很实用）：

```text
1. 看是不是"真的泄漏"：gc.collect() 后 RSS 还涨吗？（caching allocator/arena 会保留，不一定是泄漏）
2. tracemalloc：按分配点排序，找增长最快的行
3. objgraph.growth()：哪些类型的对象在持续增加
4. 常见根因：全局 list/dict 缓存无上限、循环引用 + __del__、闭包持有大对象、GPU 张量被 Python 引用住
```

**追问**：*为什么 PyTorch 的显存不释放但 Python 内存看起来正常？* CUDA 的 caching allocator 是**独立于 Python GC** 的：张量对象被回收后，显存块回到 PyTorch 的池子里（`reserved` 不降），只有 `empty_cache()` 才还给驱动。所以"Python 内存正常但 GPU 爆了"通常不是 Python 泄漏，而是**计算图/张量被引用住**。

---

## Q103. 描述符协议：`property`、`classmethod`、`staticmethod` 本质上是什么？★★★

**参考答案**

它们**都是描述符**（实现了 `__get__`/`__set__`/`__delete__` 的对象）。描述符是"**属性访问的钩子**"：当类属性是描述符时，`obj.attr` 不走普通字典查找，而是调它的 `__get__`。

```python
class Descriptor:
    def __get__(self, obj, objtype=None):
        print("get", obj, objtype); return 42
    def __set__(self, obj, value):
        print("set", value)

class C:
    x = Descriptor()

c = C()
c.x          # 调 __get__ → 打印 "get <C object> <class C>"，返回 42
c.x = 1      # 调 __set__
C.x          # obj=None → 访问的是描述符本身（这就是 classmethod 能工作的原因）
```

**三者的实现**：

| 语法 | 本质 | 关键点 |
|---|---|---|
| `@property` | 一个带 `fget/fset` 的描述符 | **数据描述符**（有 `__set__`），优先级高于实例 `__dict__` |
| `@classmethod` | 描述符，`__get__` 返回绑定到 **类** 的方法 | `super()` 能工作正是因为它拿到 `objtype` |
| `@staticmethod` | 描述符，`__get__` 直接返回**原函数** | 不绑定任何东西 |
| 普通方法 | **非数据描述符**（只有 `__get__`） | 实例 `__dict__` 可以**遮蔽**它（`obj.f = 1` 会生效） |

**数据描述符 vs 非数据描述符**（这是这题的真正考点）：

```text
obj.attr 的查找顺序：
  ① 类型的 __mro__ 里找到数据描述符（有 __set__ 或 __delete__） → 用它
  ② 实例的 __dict__                                              → 用它
  ③ 非数据描述符（只有 __get__，如函数）                          → 用它
  ④ 类属性                                                       → 用它
  ⑤ __getattr__                                                  → 兜底
```

**实际用途**：

1. **`property` 做校验/惰性计算**（最常用）。
2. **ORM 的字段**（Django/SQLAlchemy）就是用描述符把 `User.name` 映射成数据库列。
3. **`__slots__` 的底层也是描述符**（每个槽是一个 member descriptor）。
4. **缓存的懒加载属性**（`functools.cached_property` 是**非数据描述符**，所以能被实例 `__dict__` 覆盖——这是它比 property 快的原因）。

**追问**：*`__set_name__` 干什么？* 类创建时自动调用，让描述符知道自己被赋给了哪个属性名（ORM 里用它把字段名和列名关联起来，不用手写字符串）。

---

# 附录 A：一页速查（面试前 10 分钟看这个）

| 主题 | 一句话答案 |
|---|---|
| 多态实现 | vtable + vptr，两次访存 + 抑制内联 |
| 虚析构 | 可能被基类指针 delete 就必须 virtual |
| 构造/析构中调虚函数 | 不多态，vptr 只指当前层；纯虚调用 UB |
| 三/五/零法则 | 有资源就五件套；最好零法则用 RAII 容器 |
| 智能指针 | 默认 unique_ptr；共享才 shared_ptr；环用 weak_ptr |
| shared_ptr 大小 | 16 字节（对象指针 + 控制块指针） |
| make_shared | 一次分配；weak_ptr 活着时整块不释放 |
| std::move | 只是 static_cast<T&&>，不搬东西 |
| 完美转发 | 引用折叠 + std::forward 保值类别 |
| noexcept 移动 | vector 扩容用 move_if_noexcept，否则退化拷贝 |
| lambda [=] | 拷贝的是 this 指针；悬垂风险 |
| std::function | 类型擦除，可能堆分配 + 无法内联 |
| thread 析构 | joinable 未处理 → terminate |
| condition_variable | 必须 while + predicate 防虚假唤醒 |
| atomic vs volatile | volatile 不做同步，只防编译器优化 |
| 伪共享 | 同 cache line 不同变量互踢，alignas(64) |
| vector 扩容 | 2 倍（GCC）/ 1.5 倍（MSVC），摊还 O(1) |
| 迭代器失效 | vector 全失效，map 只有被删的失效 |
| GIL | 单线程跑字节码；IO 与 C 扩展释放；CPU 密集用多进程 |
| 可变默认参数 | 定义时求值一次，跨调用共享 |
| 小整数缓存 | -5..256，CPython 实现细节，别依赖 |
| 装饰器 | 高阶函数；带参要三层；wraps 保元信息 |
| 生成器 | yield 挂起保留状态；一次性；yield from 转发 |
| `with` | `__enter__`/`__exit__`，`__exit__` 返 True 吞异常 |
| MRO | C3 线性化；super() 是"下一个"不是"父类" |

# 附录 B：出处

- C++ 语言与标准库：<https://en.cppreference.com/>（各题已给具体页面）
- C++ 常见问题：<https://isocpp.org/wiki/faq>
- C++ Core Guidelines：<https://isocpp.github.io/CppCoreGuidelines/>
- Python 语言参考：<https://docs.python.org/3/reference/>
- Python FAQ（含 GIL、闭包、可变默认参数）：<https://docs.python.org/3/faq/programming.html>
- PEP 703（no-GIL）：<https://peps.python.org/pep-0703/>
- PEP 380（yield from）：<https://peps.python.org/pep-0380/>
- PEP 484 / 544（类型注解 / Protocol）：<https://peps.python.org/pep-0484/>、<https://peps.python.org/pep-0544/>
- 参考的公开题库（用于校准高频分布，未搬运原文）：[C++11 新特性面试题](https://blog.csdn.net/2401_89224684/article/details/144522806)、[interview_python](https://github.com/taizilongxu/interview_python)
