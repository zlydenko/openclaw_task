# Chromium sandbox policy

The gateway uses the official OpenClaw 2026.10.3 browser image, pinned by digest.
Its bundled Chromium is moved to /opt/ms-playwright so the writable cache mount does not hide it.
/usr/local/bin/chromium is a stable link to that executable.

chromium-seccomp.json is adapted from [Playwright v1.56.1](https://github.com/microsoft/playwright/blob/v1.56.1/utils/docker/seccomp_profile.json).
The upstream [Apache 2.0 license](chromium-seccomp.LICENSE) is included.
The profile permits clone, setns, and unshare for Chromium sandbox namespaces.
This copy also permits the chroot syscall without its container capability filter.
Chromium needs it inside its new user namespace when all container capabilities are dropped.
Linux still checks the calling process's capabilities. The gateway receives no added capabilities.
Other syscall rules are unchanged. The default action rejects unlisted syscalls.

Keep the non-root user, read-only root filesystem, no-new-privileges, and cap_drop: ALL.
Keep browser.noSandbox false. Shared memory is private and limited to 128 MiB within the container memory cap.
The gateway task limit is 512 to leave room for Chromium threads and CLI operations.
The gateway memory cap stays at 1280 MiB, and the WSL cap stays at 2 GB.
The browser and CDP ports stay unpublished. The native strict network policy remains enabled.

The isolated public-only proxy experiment was skipped. See the [README trade-offs](../README.md#browser-networking-trade-offs).
