#!/usr/bin/env python3
"""Verify the unsigned development receipt's byte/hash binding.

Hardware DS signature verification is intentionally a separate phase because the
public RSA key and enrollment record are not available until provisioning.
"""

import argparse
import hashlib
import json
import sys


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--receipt", required=True, help="Path to receipt JSON")
    parser.add_argument("--image", required=True, help="Path to the exact JPEG bytes")
    args = parser.parse_args()

    with open(args.receipt, "r", encoding="utf-8") as handle:
        receipt = json.load(handle)
    with open(args.image, "rb") as handle:
        image = handle.read()

    calculated = hashlib.sha256(image).hexdigest()
    if calculated != receipt.get("imageSha256"):
        print("FAIL imageSha256 mismatch", file=sys.stderr)
        return 1
    if receipt.get("schema") != "argus.xiao.capture.receipt.v1":
        print("FAIL unsupported receipt schema", file=sys.stderr)
        return 1

    print(json.dumps({
        "ok": True,
        "imageBytes": len(image),
        "imageSha256": calculated,
        "securityLevel": receipt.get("securityLevel"),
        "signatureAlgorithm": receipt.get("signatureAlgorithm"),
    }, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
