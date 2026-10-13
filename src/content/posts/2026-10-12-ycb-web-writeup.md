---
title: "2026 羊城杯网络安全初赛 Web 攻防思路与全复盘总结"
description: "涵盖 Shiro 鉴权绕过链条、Fastjson 原生利用以及 Spring Boot 内存马注入的完整全流程攻击复盘解析。"
pubDate: 2026-03-12
category: "极客安全与攻防"
tags: ["CTF", "Shiro", "内存马", "Java安全"]
featured: true
draft: false
coverImage: "https://images.unsplash.com/photo-1534447677768-be436bb09401?w=800&auto=format&fit=crop&q=80"
extraMeta:
  targetEvent: "2026 羊城杯"
  difficulty: "进阶"
---

## 0x01 赛题环境与架构审计

本题以经典的 Spring Boot 2.x + Apache Shiro 架构作为背景，入口点存在利用 URI 路径规范化差异的鉴权绕过机制：

```java
// 漏洞分析片段
@GetMapping("/admin/*")
public ResponseEntity<String> adminPortal(HttpServletRequest req) {
    if (ShiroUtils.isAuthenticated()) {
        return ResponseEntity.ok("Welcome Admin");
    }
    return ResponseEntity.status(403).body("Access Denied");
}
```

## 0x02 构造 Payload 与获取 Flag

利用自定义注入器将反序列化载荷注入为 Spring Controller 动态路由：

> [!IMPORTANT] 夺旗里程碑
> `flag{ycb_2026_mem_shell_injection_success}`
