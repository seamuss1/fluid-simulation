#pragma once

#ifdef _WIN32

#include <windows.h>
#include <tlhelp32.h>

#include <cwchar>
#include <iostream>
#include <limits>

namespace fluidsim {

inline DWORD getParentProcessId() {
  const DWORD currentProcessId = GetCurrentProcessId();
  DWORD parentProcessId = 0;

  HANDLE snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
  if (snapshot == INVALID_HANDLE_VALUE) {
    return 0;
  }

  PROCESSENTRY32W entry {};
  entry.dwSize = sizeof(entry);

  if (Process32FirstW(snapshot, &entry)) {
    do {
      if (entry.th32ProcessID == currentProcessId) {
        parentProcessId = entry.th32ParentProcessID;
        break;
      }
    } while (Process32NextW(snapshot, &entry));
  }

  CloseHandle(snapshot);
  return parentProcessId;
}

inline bool isExplorerLaunchedProcess() {
  const DWORD parentProcessId = getParentProcessId();
  if (parentProcessId == 0) {
    return false;
  }

  HANDLE snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
  if (snapshot == INVALID_HANDLE_VALUE) {
    return false;
  }

  bool launchedFromExplorer = false;
  PROCESSENTRY32W entry {};
  entry.dwSize = sizeof(entry);

  if (Process32FirstW(snapshot, &entry)) {
    do {
      if (entry.th32ProcessID == parentProcessId) {
        launchedFromExplorer = _wcsicmp(entry.szExeFile, L"explorer.exe") == 0;
        break;
      }
    } while (Process32NextW(snapshot, &entry));
  }

  CloseHandle(snapshot);
  return launchedFromExplorer;
}

inline void waitForExitIfExplorerLaunched(const char* prompt = "Press Enter to close...") {
  if (!isExplorerLaunchedProcess()) {
    return;
  }

  std::cout << prompt << std::flush;
  std::cin.clear();
  std::cin.ignore((std::numeric_limits<std::streamsize>::max)(), '\n');
  std::cin.get();
}

}  // namespace fluidsim

#else

namespace fluidsim {

inline void waitForExitIfExplorerLaunched(const char* = "") {}

}  // namespace fluidsim

#endif
