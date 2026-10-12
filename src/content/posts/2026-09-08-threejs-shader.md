---
title: "Three.js 拓扑曲面与自定义 GLSL 顶点着色器流体实战"
description: "探究 GLSL 顶点着色器与柏林噪声在三维地形生成中的数学原理，实现丝滑流畅的 WebGL 赛博波浪与引力扰动交互。"
pubDate: 2026-02-08
category: "软件工程与系统"
tags: ["Three.js", "WebGL", "GLSL", "前端"]
draft: false
views: "1,120"
coverImage: "https://images.unsplash.com/photo-1550745165-9bc0b252726f?w=800&auto=format&fit=crop&q=80"
extraMeta:
  difficulty: "进阶"
---

## 0x01 GPU 并行计算的数学魅力

在 CPU 端更新每个顶点的波浪位置会导致单线程瓶颈。通过将正弦/余弦流体波动方程直接迁移至 GLSL Vertex Shader，充分释放显卡数千计算单元的并行能力。

```glsl
// GLSL 自定义顶点着色器核心计算
uniform float uTime;
varying vec2 vUv;

void main() {
    vUv = uv;
    vec3 newPosition = position;
    float wave = sin(position.x * 0.05 + uTime) * 15.0 + cos(position.y * 0.04 + uTime * 1.2) * 12.0;
    newPosition.z += wave;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(newPosition, 1.0);
}
```

## 0x02 结合鼠标引力扰动

在 Uniform 中传入归一化的鼠标二维世界坐标，着色器内部计算欧氏距离实现局部的引力凹陷反馈。
