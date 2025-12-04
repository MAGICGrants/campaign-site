---
fund: monero
title: 'Monnero Fuzzing Round 2: Wallet, P2P, and FCMP++'
summary: 'This second fuzzing project will help protect the Monero network'
nym: 'MAGIC Monero Fund Committee'
coverImage: ''
website: ''
socialLinks:
  - ''
date: '2025-12-04'
goal: 50000
isFunded: false
---

Fuzzing is a process of automated testing that intelligently bombards software with random inputs to discover security vulnerabilities and edge cases. Monero has the significant advantage of access to OSS-Fuzz, Google's powerful free computing platform that continuously tests open-source projects.

[Our previous MAGIC Monero Project](https://magicgrants.org/2025/11/17/Monero-RPC-Fuzzing) contracted ADA Logics to develop fuzzing harnesses around the RPC handlers. The RPC portion of the codebase now has 100% coverage and three vulnerabilities were identified and fix within the Monero daemon. The developed harnesses will continue to run and identify new edge cases for Monero developers to fix.  However other portions of the codebase are heavily under-represented in terms of fuzzing coverage, including wallet (5.23%), common (15.87%), p2p (2.04%), and fcmp++ (0%). The goal of this proposal is to continue working with AdaLogics to improve the overall code coverage of Monero in general.

Areas that will be specifically targeted include:
- src/wallet
- src/p2p
- src/fcmp_pp

The MAGIC Monero Fund selected ADA Logics due to the success of the prior proposal. ADA Logics is a specialized security firm with deep expertise in fuzzing:

* David Korczynski (CEO) is a top contributor to OSS-Fuzz and holds a PhD from Oxford.
* They previously developed fuzzing harnesses around Monero's RPC handlers and responsibly disclosed three vulnerabilities.
* They successfully fuzzed major projects including Docker, Ethereum, and Kubernetes.
* They previously discovered a critical vulnerability in Ethereum through fuzzing (CVE-2020-28362).

Ada Logics will:
* Build C++ fuzzing harnesses targeting Monero’s wallet, p2p and fcmp code as well as other areas.
* Submit all code directly to the Monero repository.
* Provide a comprehensive report documenting the approach and findings.

## Timeline

Three months of development time across David Korczynski, Adam Korczynski, and Arthur Chan.
