---
title: "深入理解现代操作系统：从虚拟内存映射到 eBPF 内核实时观测"
description: "从页表遍历、缺页异常处理机制切入，详解如何利用 eBPF 无侵入探测用户态应用在内核态的系统调用与 I/O 延迟瓶颈。"
pubDate: 2026-02-24
category: "计算机体系沉淀"
tags: ["Linux内核", "eBPF", "虚拟内存", "系统底层"]
series: "现代系统工程演进"
draft: false
coverImage: "https://images.unsplash.com/photo-1518770660439-4636190af475?w=800&auto=format&fit=crop&q=80"
extraMeta:
  difficulty: "进阶"
---

## 0x01 四级页表与 MMU 硬件映射

现代 x86_64 与 ARM64 架构下，虚拟地址到物理地址的转换由硬件 MMU 协同多级页表完成。当访问未分配物理页或交换到磁盘的内存时，触发缺页异常（Page Fault）。

```c
// eBPF 探针追踪内核 page_fault 耗时
SEC("kprobe/handle_mm_fault")
int BPF_KPROBE(trace_mm_fault, struct vm_area_struct *vma, unsigned long address) {
    u64 pid_tgid = bpf_get_current_pid_tgid();
    u64 ts = bpf_ktime_get_ns();
    bpf_map_update_elem(&start_times, &pid_tgid, &ts, BPF_ANY);
    return 0;
}
```

## 0x02 无侵入观测收益

借助 eBPF 技术，我们可以在不重新编译内核、不增加用户态性能损耗的前提下，实时监控微秒级的 I/O 与调度排队延迟。
