"""Descriptor-level POSIX calls for the Kanon durable continuation protocol."""
import base64
import ctypes
import errno
import fcntl
import json
import os
import sys

libc = ctypes.CDLL(None, use_errno=True)
libc.realpath.argtypes = [ctypes.c_char_p, ctypes.c_void_p]
libc.realpath.restype = ctypes.c_void_p
libc.free.argtypes = [ctypes.c_void_p]
libc.free.restype = None


def encoded(value):
    return base64.b64encode(value).decode("ascii")


def ok(scalar=b"", body=b""):
    return {"kind": "ok", "scalar": encoded(scalar), "body": encoded(body)}


def unix_error(code):
    name = "EAGAIN" if code == errno.EAGAIN else errno.errorcode.get(code, "EUNKNOWN")
    return {"kind": "unix", "errno": name, "message": encoded(os.fsencode(os.strerror(code)))}


class PosixSession:
    def __init__(self):
        self.descriptors = {}
        self.next_descriptor = 3

    def close(self):
        for descriptor in self.descriptors.values():
            try:
                os.close(descriptor)
            except OSError:
                pass
        self.descriptors.clear()

    def dispatch(self, request):
        try:
            op = request["op"]
            args = [base64.b64decode(value, validate=True) for value in request["args"]]
            body = base64.b64decode(request["body"], validate=True)
            arities = {"close": 1, "write": 3, "read": 3, "fsync": 1, "ftruncate": 2,
                       "lseek": 3, "rename": 2, "mkdir": 2, "unlink": 1, "stat": 1,
                       "lockf": 3, "realpath": 1}
            if op == "open":
                if len(args) < 3:
                    return {"kind": "sys", "message": encoded(b"invalid open arguments")}
                flags = 0
                flag_values = [os.O_RDONLY, os.O_WRONLY, os.O_RDWR, os.O_CREAT, os.O_EXCL]
                for value in args[2:]:
                    index = int(value)
                    if index < 0 or index >= len(flag_values):
                        return {"kind": "sys", "message": encoded(b"invalid open flag")}
                    flags |= flag_values[index]
                descriptor = os.open(args[0], flags, int(args[1]))
                key = self.next_descriptor
                self.next_descriptor += 1
                self.descriptors[key] = descriptor
                return ok(str(key).encode("ascii"))
            if op not in arities or len(args) != arities[op]:
                return {"kind": "sys", "message": encoded(b"invalid syscall arguments")}
            if op in {"close", "write", "read", "fsync", "ftruncate", "lseek", "lockf"}:
                key = int(args[0])
                if key not in self.descriptors:
                    return unix_error(errno.EBADF)
                descriptor = self.descriptors[key]
            if op == "close":
                del self.descriptors[key]
                os.close(descriptor)
            elif op in {"write", "read"}:
                offset, length = int(args[1]), int(args[2])
                if offset < 0 or length < 0 or offset + length > len(body):
                    return {"kind": "sys", "message": encoded(b"invalid transfer range")}
                if op == "write":
                    return ok(str(os.write(descriptor, body[offset:offset + length])).encode("ascii"))
                data = os.read(descriptor, length)
                buffer = body[:offset] + data + body[offset + len(data):]
                return ok(str(len(data)).encode("ascii"), buffer)
            elif op == "fsync":
                os.fsync(descriptor)
            elif op == "ftruncate":
                os.ftruncate(descriptor, int(args[1]))
            elif op == "lseek":
                whence = {b"set": os.SEEK_SET, b"cur": os.SEEK_CUR, b"end": os.SEEK_END}[args[2]]
                return ok(str(os.lseek(descriptor, int(args[1]), whence)).encode("ascii"))
            elif op == "rename":
                os.rename(args[0], args[1])
            elif op == "mkdir":
                os.mkdir(args[0], int(args[1]))
            elif op == "unlink":
                os.unlink(args[0])
            elif op == "stat":
                os.stat(args[0])
                return ok(b"true")
            elif op == "realpath":
                if b"\x00" in args[0]:
                    return {"kind": "sys", "message": encoded(b"embedded null byte")}
                pointer = libc.realpath(args[0], None)
                if not pointer:
                    return unix_error(ctypes.get_errno())
                try:
                    return ok(body=ctypes.string_at(pointer))
                finally:
                    libc.free(pointer)
            elif op == "lockf":
                length = int(args[2])
                commands = {b"unlock": os.F_ULOCK, b"lock": os.F_LOCK,
                            b"try-lock": os.F_TLOCK, b"test": os.F_TEST}
                if args[1] in commands:
                    os.lockf(descriptor, commands[args[1]], length)
                else:
                    command = {b"read-lock": fcntl.LOCK_SH,
                               b"try-read-lock": fcntl.LOCK_SH | fcntl.LOCK_NB}[args[1]]
                    fcntl.lockf(descriptor, command, length, 0, os.SEEK_CUR)
            return ok()
        except OSError as error:
            return unix_error(error.errno)
        except (ValueError, TypeError, KeyError, OverflowError) as error:
            return {"kind": "sys", "message": encoded(os.fsencode(str(error)))}


def main():
    session = PosixSession()
    try:
        for line in sys.stdin.buffer:
            try:
                reply = session.dispatch(json.loads(line))
            except (ValueError, TypeError) as error:
                reply = {"kind": "sys", "message": encoded(os.fsencode(str(error)))}
            sys.stdout.write(json.dumps(reply, separators=(",", ":")) + "\n")
            sys.stdout.flush()
    finally:
        session.close()


if __name__ == "__main__":
    main()
