---
fund: general
title: 'Monero FCMP++ Helioselene Library Review and Curve Analysis with Veridise'
summary: 'Help MAGIC Grants recover Monero FCMP++ security review costs.'
nym: 'Justin Ehrenhofer'
coverImage: ''
website: ''
socialLinks:
  - ''
date: '2025-08-07'
goal: 36250
isFunded: true
numDonationsXMR: 2
totalDonationsXMRInFiat: 36250
totalDonationsXMR: 137.3
---

MAGIC Grants has contracted [Veridise](https://veridise.com) to assist with the following:

1. An assessment of the suitability of the Helios/Selene curve pair for use in FCMP++.
2. Manual review and formal verification of the helioselene library.

We are raising funds to cover the costs of these projects.

## Assessment of Helios/Selene Pair

Veridise will provide a detailed assessment on the security and suitability of the Helios/Selene curve pair for use in FCMP++. The list below breaks down of the work to be conducted into logical portions:

* Detailed analysis of the overall curve generation scheme, assessment of suitability of SafeCurves criteria and other alternatives given the intended use, evaluation of weight of various criteria according to the desired security requirements.
* Verification of the rigidity of the scheme to ensure curves are not manipulable.
* In-depth analysis of relevance and potential security implications of SafeCurves criteria that are not satisfied in the particular context of intended use. More precisely, analysis of the following:
  * Security implications of the small absolute discriminant
  * Various potential attacks and vulnerabilities through lack of twist security
  * ECC security implications of deviations of ladder and completeness criteria of SafeCurves, taking into account the intended use case and the used formulas, algorithms and point representations
* Preparation of a detailed report of above analysis including wider context and background.

## Manual Review and Formal Verification

Manual encoding of the below functions into an SMT-compatible encoding:

* field.rs
* red256
* red512
* pow
* invert (extended binary gcd)
* sqrt
* point.rs
* add
* double
* mul
* from_bytes
* to_bytes
