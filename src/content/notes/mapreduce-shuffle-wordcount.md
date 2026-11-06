---
title: "WordCount 不难，真正复杂的是 MapReduce 的 Shuffle"
description: "用一组可手算的键值对跟踪 InputSplit、Map、分区、排序、Shuffle、Combiner 与 Reduce，并说明正确性限制。"
updatedAt: 2026-10-23
tags: ["MapReduce", "Shuffle", "WordCount", "Batch Processing"]
status: growing
draft: true
course: distributed-data-systems
---

WordCount 可以用非常短的伪代码表达：将每个词映射为〈词，1〉，再把相同词的数字加起来。看起来像普通循环，却能被 MapReduce 扩展成分布式批处理任务。

真正承担复杂性的不是两段用户函数，而是输入如何切分、同一 key 的记录怎样聚集、任务之间如何移动中间数据，以及失败后如何重试。

## 从一个手算例子开始

输入两行文本：

~~~text
Hello Hadoop Hello
Hadoop World
~~~

Mapper 输出：

~~~text
(Hello, 1)
(Hadoop, 1)
(Hello, 1)
(Hadoop, 1)
(World, 1)
~~~

在 Reduce 之前，框架需要确保相同 key 的值能够被相应 Reducer 聚合。逻辑上可以理解为：

~~~text
Hello  -> [1, 1]
Hadoop -> [1, 1]
World  -> [1]
~~~

Reducer 对每个 key 求和：

~~~text
Hadoop 2
Hello 2
World 1
~~~

这个过程里，“相同 key 的值被聚集”并不是靠 Reducer 自己去扫描全部机器完成的。

## MapReduce 在 Map 与 Reduce 中间做了什么？

可以按四个方向理解：

**1. 分区（Partitioning）**：决定一个 key 归哪个 Reduce 分区。默认分区器通常基于 key 的哈希值和 Reducer 数量决定；这样同一 key 能进入同一分区。改变 Reducer 数量可能改变具体分区位置。

**2. 排序与分组（Sort/Group）**：Map 输出经排序、归并后，使 Reducer 能逐 key 获取属于同一组的值。排序是运行机制的一部分，不意味着所有输出都获得了全局排序——多个 Reducer 通常各自写独立分区输出。

**3. 数据传输（Shuffle/Copy）**：Reduce 端从 Map 任务完成后的中间输出获取属于自己的分区，涉及磁盘、网络、缓冲与归并。

**4. 本地归并（Merge/Spill）**：Map 端内存缓冲区不足时可能溢写到本地磁盘，随后归并中间文件；Reduce 端也可能在本地继续归并。Shuffle 不只是“一次网络复制”。

~~~text
HDFS 输入
   │
 InputSplit
   │
  Mapper
   │
分区 + 排序 + 可能溢写
   │
Shuffle：拉取对应分区
   │
归并 + 分组
   │
 Reducer
   │
HDFS 输出
~~~

其中 InputSplit（输入切分）是由 InputFormat 提供的逻辑输入分片，不一定与 HDFS 物理块一一对应。

## Combiner 为什么只是可选优化？

WordCount 可能先在每个 Map 输出位置局部相加：

~~~text
Map A: Hello 1, Hello 1
Combiner: Hello 2
~~~

这样可以减少后续传输量。但 Combiner 不是所有作业都能启用，也不保证一定运行几次。只有局部合并不改变最终正确性时，才应将相应操作用作 Combiner。

例如直接取平均值并把它再次取平均，通常不保证全局平均正确；需要保留“总和、计数”等足够统计量，才能安全地组合。

把 Combiner 当成“提前执行一次 Reducer”可能在某些任务上工作，在另一些任务上产生错误结果。

## 任务失败时发生什么？

MapReduce 可以重试失败的任务。对于纯函数式的 Mapper/Reducer，这种重试通常比在每条记录上执行外部扣款等副作用更容易处理。

因此任务函数原则上应尽量可重复、可重放，不能不加设计就往外部数据库写入不可逆操作。**框架对任务的重试能力，不等于自动保证所有外部副作用恰好一次。**

## 如何在已有环境中验证？

基础 HDFS 文件操作已完成，但尚没有可靠保存的 MapReduce 作业日志，因此本篇不声称 WordCount 已在 YARN 集群上运行。

待执行的最小实验包括：

1. 将两行测试文本上传到独立 HDFS 测试目录；
2. 查看 Hadoop 2.7.1 自带 examples jar 或编译一个 WordCount 程序；
3. 确定当时使用 Local、Standalone 还是 YARN 执行模式；
4. 保存作业 ID、Map/Reduce task 数量、成功日志和输出；
5. 设置不同 Reducer 数量，比较输出文件数量与分区结果。

应记录实际 jar 路径、配置和模式，而不是复用一条未经核实就宣称通用的提交命令。

## 参考资料

- 《云计算与大数据》：第 6 章 MapReduce、Shuffle 和 WordCount。
- [Apache Hadoop 2.7.1 — MapReduce Tutorial](https://hadoop.apache.org/docs/r2.7.1/hadoop-mapreduce-client/hadoop-mapreduce-client-core/MapReduceTutorial.html)

> **待补实验**：独立 WordCount 运行记录、Shuffle 指标、Reducer 数量变化；目前为机制解析草稿。
