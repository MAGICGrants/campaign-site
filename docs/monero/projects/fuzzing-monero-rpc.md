---
fund: monero
title: 'Fuzzing Harness Development for Monero’s RPC handlers'
summary: 'This fuzzing project will help protect the Monero network'
nym: 'MAGIC Monero Fund Committee'
coverImage: ''
website: ''
socialLinks:
  - ''
date: '2025-05-20'
goal: 55000
---

Fuzzing is a process of automated testing that intelligently bombards software with random inputs to discover security vulnerabilities and edge cases. Monero has the significant advantage of access to OSS-Fuzz, Google's powerful free computing platform that continuously tests open-source projects. However, our current testing implementation is severely limited, covering merely 10% of the codebase—with zero coverage of the critical RPC interfaces that allow external communication with Monero nodes.

Developing comprehensive fuzzing harnesses for these RPC handlers is essential to protecting Monero's network infrastructure from remote attacks, preserving both user privacy and security of funds. This project directly addresses one of our most significant security blind spots.

The MAGIC Monero Fund selected Ada Logics after soliciting three quotes from various security firms to start development of fuzzing harnesses for monerod. [Ada Logics](https://adalogistics.com) is a specialized security firm with deep expertise in fuzzing:

* David Korczynski (CEO) is a top contributor to OSS-Fuzz and holds a PhD from Oxford
* Their team has successfully fuzzed major projects including Docker, Ethereum, and Kubernetes
* They [previously discovered](https://adalogics.com/blog/the-importance-of-continuity-in-fuzzing-cve-2020-28362) a critical vulnerability in Ethereum through fuzzing (CVE-2020-28362)

Ada Logics will:

* Build C++ fuzzing harnesses for Monero's RPC handlers.
* Create an end-to-end testing solution for Monero in OSS-Fuzz.
* Target at least 75% of Monero's RPC handlers, with a goal of 100% coverage.
* Submit all code directly to the Monero repository.
* Provide a comprehensive report documenting the approach and findings.

## Timeline

Six weeks of development time across David Korczynski, Adam Korczynski, and Arthur Chan.
