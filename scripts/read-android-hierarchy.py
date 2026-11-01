#!/usr/bin/env python3
"""Read accessibility only; no app launch, taps, login or publication."""
import argparse
import contextlib
import logging
import re
import signal
import sys
from xml.etree import ElementTree


def read_hierarchy(serial, timeout_seconds, connect=None):
    if not re.fullmatch(r"[\w.:-]+", serial, flags=re.ASCII):
        raise ValueError("invalid device")
    if not 0 < timeout_seconds <= 300:
        raise ValueError("invalid timeout")
    if connect is None:
        import adbutils
        import uiautomator2
        # Passing an existing device avoids u2's disconnect/reconnect loop.
        device = adbutils.adb.device(serial=serial)
        connect = lambda _serial: uiautomator2.connect(device)
    device = connect(serial)
    try:
        device.jsonrpc.setConfigurator(
            {"waitForIdleTimeout": 0, "waitForSelectorTimeout": 0},
            http_timeout=timeout_seconds,
        )
        # Keep all semantic nodes; visibility and selected-tray provenance are
        # checked by the caller, without relying on an off-screen text label.
        xml = device.dump_hierarchy(compressed=False, max_depth=80, root_in_active=True)
        if "<!DOCTYPE" in xml.upper() or "<!ENTITY" in xml.upper():
            raise ValueError("invalid hierarchy")
        tree = ElementTree.fromstring(xml)
        if tree.tag != "hierarchy" or not list(tree.iter("node")):
            raise ValueError("empty hierarchy")
        return xml
    finally:
        # Stops only the server process owned by this client, when it started it.
        device.stop_uiautomator(wait=False)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--device", required=True)
    parser.add_argument("--timeout", required=True, type=float)
    args = parser.parse_args()
    logging.disable(logging.CRITICAL)

    def expired(_signal, _frame):
        raise TimeoutError("hierarchy deadline")

    signal.signal(signal.SIGALRM, expired)
    try:
        if not 0 < args.timeout <= 300:
            raise ValueError("invalid timeout")
        signal.setitimer(signal.ITIMER_REAL, args.timeout)
        # Third-party diagnostics must never contaminate the XML stream.
        with contextlib.redirect_stdout(sys.stderr):
            xml = read_hierarchy(args.device, args.timeout)
        signal.setitimer(signal.ITIMER_REAL, 0)
        sys.stdout.write(xml)
        return 0
    except Exception:
        sys.stderr.write("android_hierarchy_unavailable\n")
        return 2
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)


if __name__ == "__main__":
    sys.exit(main())
