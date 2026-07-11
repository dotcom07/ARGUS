#!/usr/bin/env python3
"""Read one boot/capture window from the XIAO ESP32-S3 Sense serial console."""

import argparse
import time

import serial


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", default="/dev/cu.usbmodem101")
    parser.add_argument("--seconds", type=float, default=36.0)
    parser.add_argument(
        "--nonce",
        default="a" * 64,
        help="server nonce sent to the firmware capture command",
    )
    parser.add_argument(
        "--session-id",
        default="",
        help="optional relayer capture session ID for Wi-Fi upload",
    )
    args = parser.parse_args()

    with serial.Serial(args.port, 115200, timeout=1) as port:
        # Allow boot logs to arrive before asking for the first frame.
        time.sleep(2)
        command = f"CAPTURE {args.nonce}"
        if args.session_id:
            command += f" {args.session_id}"
        port.write(f"{command}\n".encode("ascii"))
        port.flush()

        deadline = time.monotonic() + args.seconds
        while time.monotonic() < deadline:
            line = port.readline()
            if line:
                print(line.decode("utf-8", errors="replace"), end="")


if __name__ == "__main__":
    main()
