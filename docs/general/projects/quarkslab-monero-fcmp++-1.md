---
fund: general
title: 'Monero FCMP++ Cryptography Audit (1a/1b) with Quarkslab'
summary: 'Help MAGIC Grants fund Monero FCMP++ audits.'
nym: 'Justin Ehrenhofer'
coverImage: ''
website: ''
socialLinks:
  - ''
date: '2026-04-24'
goal: 50000
isFunded: false
---

MAGIC Grants is supporting Justin Berman's efforts to audit Monero FCMP++ code. After a [robust selection process](https://github.com/seraphis-migration/monero/issues/294#issuecomment-4291345141), Quarkslab has been selected to audit sections 1a and 1b of the scope [listed here](https://github.com/seraphis-migration/monero/issues/294).

The scope is also included here (authored by Justin Berman):

## Audit 1a: Crypto

Below are PR's we would like audited for this phase. For each PR, we include Audit Goals. It is our intent that by achieving the Audit Goals, the audit would answer the question "Is the linked PR fit for use in Monero?" If auditors have any additional insights that can help answer that question for each PR, and those insights do not relate to something explicitly stated in the linked PR's Audit Goals, then we would appreciate the insight nonetheless.

Note that most of the PR's build off each other by cherry-picking commits. An auditor may find it easier to review each commit sequentially, rather than each PR as a whole.

- [Faster transparent amount commitments](https://github.com/monero-project/monero/pull/10108)
  - `rct::zeroCommitVartime`
  - Audit Goals:
    - Is the cryptographic algorithm used in the function sound from a cryptographic standpoint?
    - Is the code implemented correctly? For example, in addition to auditing cryptographic security, we would also hope that an audit would catch an issue like [this one](https://github.com/seraphis-migration/monero/pull/119) that was in the code originally.
- [Batch inverse](https://github.com/monero-project/monero/pull/10111)
  - `fe_batch_invert`
  - `fe_equals`
  - Audit Goals:
    - Is the cryptographic algorithm used in each function sound from a cryptographic standpoint?
    - Is the code implemented correctly assuming the cryptography is sound?
    - Are the functions constant time?
- [Torsion clearing](https://github.com/monero-project/monero/pull/10342)
  - `clear_torsion`
  - `get_valid_torsion_cleared_point`
  - `rct::verPointsForTorsion`
  - `mul8_is_identity`
  - Audit Goals:
    - Is the cryptographic algorithm used in each function sound from a cryptographic standpoint and achieve their stated objective? For example, does the algorithm in `clear_torsion` adequately "clear torsion" from a cryptographic standpoint etc.
    - Is the code in each function implemented correctly assuming the above is true?
    - Are `clear_torsion` and `mul8_is_identity` constant time?
- [Unbiased key image generator](https://github.com/monero-project/monero/pull/10338)
  - Audit Goals:
      - Verify the rationale shared in https://github.com/monero-project/research-lab/issues/142 that Monero's existing hash-to-point function is in fact biased (the function named `biased_hash_to_ec` in the PR). If you can prove that the existing hash-to-point function is **not** actually biased as posited in that issue, then we do not need this PR and that is a satisfactory conclusion for this "Unbiased key image generator" item.
      - If you concur with the rationale of that issue that the existing hash-to-point *may* be biased, then we also have the following additional goals:
        - Does the `unbiased_hash_to_ec` function achieve the stated goal of being "unbiased"? By this we mean:
           - Does the implementation match Elligator 2 as specified in the Elligator paper: https://eprint.iacr.org/2013/325.pdf ? We are aware the implementation does not match the IRTF specification.
           - Is the algorithm utilized in the function unbiased from a cryptographic security standpoint?
           - Is the algorithm utilized in the function collision resistant?
           - Does the code perform as claimed assuming the cryptographic protocol utilized in the function is unbiased?
      - We hope answering the above questions will answer "is the PR fit for use in Monero." If you have additional insights that can help answer that question, that would also be appreciated.
- [`fe_reduce_vartime`](https://github.com/monero-project/monero/pull/10135)
  - Audit Goals:
     - Is the rationale shared in the comment valid rationale for introducing `fe_reduce_vartime`?
     - Is `fe_reduce_vartime` sound from a cryptographic standpoint?
     - Is the code introduced by the PR implemented correctly assuming the cryptography is sound?
- [ed25519 -> wei conversion](https://github.com/monero-project/monero/pull/10345)
  - `point_to_ed_derivatives`
  - `ed_derivatives_to_wei_x_y`
  - `fe_ed_derivatives_to_wei_x_y`
  - Audit Goals:
     - Do the functions correctly implement the specification detailed in section E.2 of the paper linked:  https://www.ietf.org/archive/id/draft-ietf-lwig-curve-representations-02.pdf
     - Do the constants introduced (`fe_a`, `fe_a_inv_3`, `fe_c`) match the constants specified in the paper?
     - Is `fe_ed_derivatives_to_wei_x_y` constant time?
- [ Ed25519 -> X25519 conversion](https://github.com/monero-project/monero/pull/9828)
  - `ge_p3_to_x25519`
  - `edwards_bytes_to_x25519_vartime`
  - Audit Goals:
     - Do the functions correctly derive the X25519 x-coordinate from an Ed25519 point from a cryptographic standpoint?
     - Is the code in each function implemented correctly assuming the above is true?

## Audit 1b: Integrated Crypto

Below are PR's we would like audited for this phase. For each PR, we include Audit Goals. It is our intent that by achieving the Audit Goals, the audit would answer the question "Is the linked PR fit for use in Monero?" If auditors have any additional insights that can help answer that question for each PR, and those insights do not relate to something explicitly stated in the linked PR's Audit Goals, then we would appreciate the insight nonetheless.

Note that most of the PR's build off each other by cherry-picking commits. An auditor may find it easier to review each commit sequentially, rather than each PR as a whole.

- [Converting outputs to tuples in prep for insertion to the curve tree merkle tree](https://github.com/monero-project/monero/pull/10358)
  - `output_to_tuple`
  - `output_to_pre_leaf_tuple`
  - Audit Goals:
      - Verify that none of `O, I, C` can have torsion, and contain correct identity checks, both from a cryptographic standpoint and correctly implemented coding standpoint.
      - Verify the claim that no output or commitment detectable as a valid receive on the Monero blockchain today (or at any point in the past) would cause `output_to_tuple` to throw. This is critical because it means that an output that is detectable as a valid receive under existing/prior rules would *not* be spendable **after** FCMP++ goes into effect.
        - This excludes exceptional cases, such as when the person who creates the address chooses one specifically to cause conflicts (e.g. with a torsioned spend key, or a spend key proportional to a specific rerandomization of the view key), or cases with negligible statistical probability. The basic goal is to determine if a malicious actor could feasibly prevent an honest user from being able to spend a validly detectable received output by maliciously constructing outputs, or if an honest user could naturally end up crafting such an output.
- [Rust FFI + constructing Selene scalar object from byte representation](https://github.com/monero-project/monero/pull/10359)
  - `selene_scalar_from_bytes`
  - `SeleneScalar`
  - Audit Goals:
      - Verify [this `SeleneScalar`](https://github.com/j-berman/monero/blob/b549d491f1cb38a635d6fd5a95918776a6d37958/src/fcmp_pp/fcmp_pp_rust/fcmp%2B%2B.h#L36-L39) struct is the correct C representation of [this Rust object](https://github.com/serai-dex/serai/blob/737dbcbaa78ab817cc1c435cb2b6c5d24d1c4391/crypto/dalek-ff-group/src/field.rs#L40) (the helioselene crate exposes that object as `Field25519` [here](https://github.com/monero-oxide/monero-oxide/blob/92af05e0d44bd1ec1fed6028a8d2aade615f805a/crypto/helioselene/src/lib.rs#L23)).
      - Verify that the function `fcmp_pp::tower_cycle::selene_scalar_from_bytes` calls `selene_scalar_from_bytes` in `fcmp++.h` safely from a runtime and memory standpoint.
      - Verify that the `selene_scalar_from_bytes` in `lib.rs` is implemented correctly from a runtime and memory standpoint, and calls [`read_F`](https://github.com/serai-dex/serai/blob/737dbcbaa78ab817cc1c435cb2b6c5d24d1c4391/crypto/ciphersuite/src/lib.rs#L74) in a safe manner from the same standpoint as well as a cryptographically secure standpoint.
      - Verify that the Rust FFI layer is set up in a manner that is fit for production use in Monero (`fcmp++.h`, the CMake file that builds the Rust static lib that is called from the C++, `lib.rs`, and the C++ callers).
- [ed25519 outputs -> curve tree leaves](https://github.com/monero-project/monero/pull/10360)
  - `outputs_to_leaves`
  - Audit Goals:
     - Verify that `outputs_to_leaves` is implemented correctly both from a cryptographic standpoint and memory/runtime standpoint.
