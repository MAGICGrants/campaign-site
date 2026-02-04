---
fund: monero
title: "More Efficient Zero-Knowledge Range Proofs for Monero"
summary: 'This research project aims to speed up Bulletproofs'
nym: 'MAGIC Monero Fund Committee'
coverImage: ''
website: ''
socialLinks:
  - ''
date: '2026-02-03'
goal: 18708
isFunded: false
---

Monero currently uses Bulletproofs+ to prove that transaction amounts are valid without revealing the amount. While Bulletproofs+ provides compact proofs ideal for blockchain storage constraints, computational costs remain a bottleneck. Prover time affects user experience when sending transactions, and verifier time impacts node scalability during block verification and chain synchronization.

Developing more efficient zero-knowledge range proofs will be valuable for future upgrades. This project targets a speedup for both prover and verifier by reducing the number of expensive group exponentiations, while maintaining the current proof size. This project is research-oriented, with bulletproof improvements expected to benefit the Monero community.

A copy of the project proposal with more technical information [can be found here](https://magicgrants.org/files/2026-01-28-range-proof-proposal.pdf).

This project will be executed by two researchers at CSIRO (Australia’s national science agency):

* Dr Nan Wang (Principal Investigator) is a research scientist with extensive publications on zero-knowledge proofs at top-tier venues including IEEE S&P, USENIX Security, AsiaCrypt, and PETs. He was the lead author of SwiftRange (IEEE S&P 2024) and Flashproofs (AsiaCrypt 2022). https://www.nan-wang.com
* Dr Dongxi Liu (Co-Investigator) is a principal research scientist with publications in CCS, IEEE S&P, NDSS, USENIX Security, Crypto, and PETs, along with patents in consensus and key distribution. https://people.csiro.au/L/D/Dongxi-Liu

The project deliverables are:

* Design and prototype a new range proof construction in Java with benchmarks against Bulletproofs+.
* Provide formal security proofs.
* Deliver a comprehensive technical report with full protocol specification, security analysis, and open-source implementation to facilitate review and integration.
* Release all code and results under an MIT license to benefit Monero and push forward privacy research.

Timeline: 13 weeks total

* Milestone 1 — Protocol Development (9 weeks): design, Java prototype, and benchmarking.
* Milestone 2 — Report Writing (4 weeks): technical report, security analysis, implementation, and integration support.
