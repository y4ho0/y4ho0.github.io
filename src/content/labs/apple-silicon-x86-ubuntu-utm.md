---
title: "在 Apple Silicon 上运行 x86_64 Ubuntu：一次从 VirtualBox 到 UTM 的迁移"
description: "保留现有 Ubuntu 与 Hadoop 环境，在 M2 Pro Mac 上完成跨架构模拟、虚拟磁盘迁移、启动排障及 SSH 连接。"
updatedAt: 2026-10-23
tags: ["Linux", "Apple Silicon", "UTM", "QEMU", "Troubleshooting"]
status: growing
draft: true
course: distributed-data-systems
related:
  - collection: labs
    entry: hdfs-command-experiments
  - collection: notes
    entry: hadoop-storage-compute-scheduling
---

一份已经配置好 Java 和 Hadoop 的 Ubuntu 虚拟机，理论上只需导入 VirtualBox 就能运行。但当宿主机是 Apple M2 Pro，而镜像面向 x86_64 架构时，“导入并启动”就变成了一次完整的环境迁移。

最终方案是使用 UTM 的 QEMU 模拟功能运行原有虚拟硬盘，再通过 SSH 从 macOS 终端操作 Ubuntu。途中遇到的失败包括磁盘空间耗尽、进入 UEFI Shell、图形启动卡住以及中文显示异常。以下按照实际出现问题的顺序记录，而不是重新罗列一份理想化安装教程。

## 为什么需要模拟，而不只是安装一个虚拟机软件？

Apple Silicon 采用 ARM64 指令集，原镜像使用 x86_64。两者的机器指令并不兼容：在 ARM Mac 上创建一台 ARM Linux 虚拟机，与运行现成的 x86_64 Linux 客户机，不是同一件事。

同架构的**虚拟化（Virtualization）**可以利用硬件支持直接执行大量客户机代码；**模拟（Emulation）**则必须实现另一套处理器及设备行为，兼容性范围更广，但通常速度较慢。UTM 提供基于 QEMU（Quick Emulator）的系统模拟。

因此这里选择 **Emulate → x86_64**，目标是尽量保持原有 Linux、Java、Hadoop 环境，不去重装另一套 ARM 版本的软件。

## OVA 不是系统安装 ISO

文件名为 Ubuntu_Bigdata.ova。先检查归档：

~~~bash
tar -tf Ubuntu_Bigdata.ova
~~~

~~~text
Ubuntu_Bigdata.ovf
Ubuntu_Bigdata-disk001.vmdk
Ubuntu_Bigdata.mf
~~~

OVA（Open Virtualization Appliance）是虚拟机归档。OVF 保存虚拟机描述，VMDK（Virtual Machine Disk）保存已有磁盘，MF 保存校验信息。它包含的并非等待安装的空白系统，而是一台已经使用过的虚拟机。

进一步检查其中的硬件配置：

~~~bash
tar -xOf Ubuntu_Bigdata.ova Ubuntu_Bigdata.ovf \
  | grep -Ei "OSType|VirtualSystemType|StorageController|AHCI|BIOS"
~~~

配置带有 VirtualBox 信息，也出现 IDE、SATA（AHCI）以及 BIOS 相关字段。这意味着迁移时除了磁盘内容，还需要关心虚拟硬件和固件如何引导系统。

### 第一次解压就失败了

~~~bash
mkdir Ubuntu_Bigdata
tar -xvf Ubuntu_Bigdata.ova -C Ubuntu_Bigdata
~~~

中途报错：

~~~text
Write failed: No space left on device
~~~

检查后发现磁盘文件本身已有约 6.1 GB：

~~~bash
du -sh Ubuntu_Bigdata/Ubuntu_Bigdata-disk001.vmdk
df -h ~
~~~

迁移时可能同时存放原始 OVA、解压得到的 VMDK，以及 UTM 导入后的磁盘文件。因此不能只按归档文件大小估算空间。清理空间并重新解压后，三个文件才完整出现。

## 虚拟磁盘导入成功，系统却进了 UEFI Shell

UTM 中创建的客户机配置为 x86_64、2 核 CPU、4 GB 内存，导入 VMDK 后选择 IDE 硬盘接口。导入后的磁盘显示为 QCOW2（QEMU Copy-On-Write 2）格式，虚拟容量约 12 GB；这里的虚拟容量不等于实际占用的主机磁盘空间。

首次启动没有出现 Ubuntu，而是：

~~~text
UEFI Interactive Shell v2.2
Shell>
~~~

**进入 UEFI Shell 不能直接证明磁盘损坏。** 它至少说明固件没有按预期完成系统引导。排查重点由“文件是否导入”转向“固件启动模式、引导设备和磁盘接口是否匹配”。

回头对照 OVF 中的 BIOS、IDE 和 SATA 配置，调整 UTM 启动相关设置后，系统成功进入 GRUB 菜单。

> **记录边界：** 当时没有逐项保存每次固件设置变化及对照启动结果，无法把成功严格归因于某一个开关。因此这里记录已观察到的状态转换，不将它包装为唯一的通用修复方法。

<!-- 待补图：UTM 磁盘设置、UEFI Shell 画面、首次进入 GRUB 的画面。 -->

## 能看到 GRUB，却进不了桌面

选择 Ubuntu Kylin 后，系统启动动画长时间没有消失。等待约十五分钟、尝试切换文本终端以及重启后，现象依旧。

这时至少可以认为：虚拟机已经走过固件和 GRUB 阶段。为了避免把“图形桌面无法显示”误认为“整个 Linux 都不能运行”，决定先尝试不启动图形桌面。

在 GRUB 中选中 Ubuntu，按 **e**，找到以 **linux** 开头的内核命令，在原有参数位置加入：

~~~text
nomodeset systemd.unit=multi-user.target
~~~

按 **Ctrl+X** 用临时参数启动。

- **nomodeset** 禁用内核图形模式设置（Kernel Mode Setting），可用于部分图形问题排查。
- **systemd.unit=multi-user.target** 将启动目标设为多用户文本模式，跳过图形桌面目标。

随后出现：

~~~text
Ubuntu 16.04 LTS
dblab-VirtualBox login:
~~~

成功登录。这证明该镜像在当前模拟器上能够运行内核和基本用户空间，但**无法确定图形卡住的根因**：两个参数同时改变，没有分别验证，不能直接断言某个显卡驱动出了问题。

临时 GRUB 参数在下一次启动时会失效。若确认只需长期使用文本模式，可以在检查原文件后修改 **/etc/default/grub** 中的启动参数，再执行：

~~~bash
sudo update-grub
~~~

更稳妥的做法是先保留原配置，并记录每次改动，以便撤销。

<!-- 待补图：GRUB 临时参数、文本模式登录成功画面。 -->

## 为什么最后改用 SSH？

系统启动后，UTM 提供的 Linux 纯文本控制台还有实际使用障碍：中文字符显示不完整、滚动查阅长日志不方便、复制命令不顺手。

~~~bash
export LANG=C
export LC_ALL=C
~~~

这可以让部分程序使用英文消息，却**不能安装中文字体，也不能保证纯文本控制台显示中文**。

解决交互问题不一定需要修复图形桌面。Ubuntu 已运行 SSH（Secure Shell，安全远程登录协议）服务，于是检查状态和网络地址：

~~~bash
sudo service ssh status
ip -4 addr
~~~

在本次 UTM 网络环境中，客户机曾获得 192.168.64.2。在 macOS Terminal 中连接：

~~~bash
ssh hadoop@192.168.64.2
~~~

完成首次主机密钥确认和密码认证后，提示符变为：

~~~text
hadoop@dblab-VirtualBox:~$
~~~

现在 UTM 仍负责运行 x86_64 Ubuntu，而 macOS 终端负责交互：可以直接复制命令、滚动查看输出，也不再受 Linux 文本控制台中文显示限制。这里使用的是虚拟网络内的地址，不应把旧版 Ubuntu 的 SSH 服务直接开放到公网。

## 最后检验：原有 Hadoop 还能工作吗？

仅能登录系统，不代表迁移成功。还需要验证已有软件与服务：

~~~bash
java -version
/usr/local/hadoop/bin/hadoop version
cd /usr/local/hadoop
./sbin/start-dfs.sh
jps
~~~

实际环境检查到了 OpenJDK **1.8.0_131**、Hadoop **2.7.1**，并能看到 **NameNode、DataNode、SecondaryNameNode** 进程。随后完成 HDFS 文件创建、上传、读取、下载和重命名等基础操作。

这足以证明**这些具体任务可用**，却不是兼容性全量测试，也没有做跨架构性能对比。

<!-- 待补图：Mac Terminal SSH 成功、java/hadoop version、jps 验证。 -->

## 回头看

同一个“虚拟机启动失败”，可能落在完全不同的层次：

| 观察到的现象 | 更值得排查的层次 |
| --- | --- |
| x86_64 系统无法直接运行 | 处理器架构与执行方式 |
| 解压失败 | 主机磁盘空间 |
| 进入 UEFI Shell | 固件与引导配置 |
| GRUB 之后长时间卡住 | 内核启动或用户空间服务 |
| 文本终端中文异常 | 终端字符显示能力 |
| Hadoop 连接被拒绝 | NameNode 等服务的运行状态 |

最终并没有把图形桌面恢复到正常状态；所需的命令行环境和 Hadoop 功能已验证可用。对于需要保留已有 x86 系统的迁移任务，逐层确认失败位置，比盲目重装更容易保留有价值的环境信息。

## 参考资料

- [UTM Documentation](https://docs.getutm.app/)
- [QEMU System Emulation](https://www.qemu.org/docs/master/system/)
- [QEMU Disk Images](https://www.qemu.org/docs/master/system/images.html)
- [Linux Kernel Parameters](https://www.kernel.org/doc/html/latest/admin-guide/kernel-parameters.html)

> **草稿校对清单：** 补充真实截图；确认持久化 GRUB 参数最终是否执行成功；补齐 UTM 固件设置变更的前后对照。未完成校对前保持草稿状态。
