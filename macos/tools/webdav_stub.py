#!/usr/bin/env python3
"""Minimal WebDAV server for testing the CloudDisk macOS mount client.

This is *not* part of the product. It exists so that `mount-smoke` and the
menu-bar app can be exercised end-to-end when a real CloudDisk server is not
available (or before it is started).

It implements just enough of RFC 4918 for macOS `webdavfs` to mount the
endpoint read-write:

  OPTIONS, PROPFIND (depth 0/1), PROPPATCH, GET, HEAD, PUT, DELETE, MKCOL,
  COPY, MOVE, LOCK, UNLOCK

HTTP Basic auth is required. Files are stored in a scratch directory.

Usage:
  python3 webdav_stub.py --port 18888 --user admin --password clouddisk
  # endpoint: http://127.0.0.1:18888/CloudDisk
"""

import argparse
import base64
import datetime
import email.utils
import hashlib
import os
import re
import shutil
import sys
import tempfile
import threading
import uuid
import xml.etree.ElementTree as ET
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote, urlsplit

DAV_NS = "DAV:"
PREFIX = "/CloudDisk"

PROP_NAMES = {
    "displayname": "{DAV:}displayname",
    "resourcetype": "{DAV:}resourcetype",
    "getcontentlength": "{DAV:}getcontentlength",
    "getcontenttype": "{DAV:}getcontenttype",
    "getlastmodified": "{DAV:}getlastmodified",
    "getetag": "{DAV:}getetag",
    "creationdate": "{DAV:}creationdate",
    "supportedlock": "{DAV:}supportedlock",
    "lockdiscovery": "{DAV:}lockdiscovery",
    "quota-available-bytes": "{DAV:}quota-available-bytes",
    "quota-used-bytes": "{DAV:}quota-used-bytes",
}

LOCKS = {}          # url path -> lock token
LOCKS_LOCK = threading.Lock()


def http_date(ts):
    return email.utils.formatdate(ts, usegmt=True)


def iso_date(ts):
    return datetime.datetime.utcfromtimestamp(ts).strftime("%Y-%m-%dT%H:%M:%SZ")


def etag(path, st):
    h = hashlib.sha1()
    h.update(f"{path}:{st.st_size}:{st.st_mtime_ns}".encode())
    return '"' + h.hexdigest()[:16] + '"'


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "CloudDisk-WebDAV-Stub/1.0"

    # ---------- helpers ----------

    @property
    def root(self):
        return self.server.root

    def log_message(self, fmt, *args):  # quiet-ish
        sys.stderr.write("[stub] %s - %s\n" % (self.address_string(), fmt % args))

    def end_headers(self):
        self.send_header("DAV", "1, 2")
        self.send_header("MS-Author-Via", "DAV")
        self.send_header("Server", self.server_version)
        super().end_headers()

    def send_body(self, code, body=b"", ctype="application/xml; charset=utf-8",
                  extra_headers=None):
        if isinstance(body, str):
            body = body.encode("utf-8")
        self.send_response(code)
        if ctype:
            self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        for k, v in (extra_headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def authorized(self):
        hdr = self.headers.get("Authorization", "")
        if not hdr.startswith("Basic "):
            return False
        try:
            raw = base64.b64decode(hdr[6:]).decode("utf-8", "replace")
        except Exception:
            return False
        user, _, pw = raw.partition(":")
        return user == self.server.user and pw == self.server.password

    def require_auth(self):
        if self.authorized():
            return True
        self.read_body()
        self.send_body(
            401,
            "authentication required\n",
            "text/plain; charset=utf-8",
            {"WWW-Authenticate": 'Basic realm="CloudDisk", charset="UTF-8"'},
        )
        return False

    def dav_path(self):
        """Return (fs relative path segments, url path, trailing slash)."""
        raw = urlsplit(self.path).path
        trailing = raw.endswith("/")
        decoded = unquote(raw)
        if decoded == PREFIX:
            rel = "/"
        elif decoded.startswith(PREFIX + "/"):
            rel = decoded[len(PREFIX):]
        else:
            rel = decoded  # tolerate requests outside the prefix
        rel = rel or "/"
        return rel, trailing

    def fs_path(self, rel):
        clean = os.path.normpath("/" + rel).lstrip("/")
        full = os.path.join(self.root, clean)
        if not os.path.abspath(full).startswith(os.path.abspath(self.root)):
            raise ValueError("path escape")
        return full

    def href(self, rel, is_dir):
        p = PREFIX + ("" if rel in ("", "/") else rel)
        p = p.replace("//", "/")
        if is_dir and not p.endswith("/"):
            p += "/"
        return p

    def read_body(self):
        """Read (and cache) the request body exactly once.

        WebDAV clients such as macOS `webdavfs` pipeline requests on a
        keep-alive connection.  If a body is left unread (e.g. when we answer
        401) the leftovers are parsed as a bogus request line, so every
        handler drains the body before responding.
        """
        if getattr(self, "_cached_body", None) is not None:
            return self._cached_body
        length = int(self.headers.get("Content-Length") or 0)
        data = b""
        if length > 0:
            data = self.rfile.read(length)
        self._cached_body = data
        return data

    def body_text(self):
        return self.read_body().decode("utf-8", "replace")

    # ---------- XML ----------

    def propstat(self, rel, fs):
        st = os.stat(fs)
        is_dir = os.path.isdir(fs)
        props = []
        if is_dir:
            rt = "<D:collection/>"
        else:
            rt = ""
        props.append(f"<D:displayname>{os.path.basename(fs.rstrip('/')) or 'CloudDisk'}</D:displayname>")
        props.append(f"<D:resourcetype>{rt}</D:resourcetype>")
        props.append(f"<D:creationdate>{iso_date(st.st_ctime)}</D:creationdate>")
        props.append(f"<D:getlastmodified>{http_date(st.st_mtime)}</D:getlastmodified>")
        props.append(f"<D:getetag>{etag(rel, st)}</D:getetag>")
        if not is_dir:
            props.append(f"<D:getcontentlength>{st.st_size}</D:getcontentlength>")
            props.append("<D:getcontenttype>application/octet-stream</D:getcontenttype>")
        else:
            props.append("<D:getcontentlength>0</D:getcontentlength>")
        props.append(
            "<D:supportedlock>"
            '<D:lockentry><D:lockscope><D:exclusive/></D:lockscope>'
            "<D:locktype><D:write/></D:locktype></D:lockentry>"
            "</D:supportedlock>"
        )
        token = LOCKS.get(rel)
        if token:
            props.append(
                "<D:lockdiscovery><D:activelock>"
                f"<D:locktype><D:write/></D:locktype>"
                "<D:lockscope><D:exclusive/></D:lockscope>"
                "<D:depth>infinity</D:depth>"
                "<D:owner><D:href>stub</D:href></D:owner>"
                f"<D:timeout>Second-3600</D:timeout>"
                f"<D:locktoken><D:href>{token}</D:href></D:locktoken>"
                f"<D:lockroot><D:href>{self.href(rel, is_dir)}</D:href></D:lockroot>"
                "</D:activelock></D:lockdiscovery>"
            )
        else:
            props.append("<D:lockdiscovery/>")
        if is_dir and rel in ("/", ""):
            try:
                usage = 0
                for dirpath, dirs, files in os.walk(fs):
                    for f in files:
                        usage += os.path.getsize(os.path.join(dirpath, f))
                quota = 10 * 1024 * 1024 * 1024
                props.append(f"<D:quota-used-bytes>{usage}</D:quota-used-bytes>")
                props.append(f"<D:quota-available-bytes>{quota - usage}</D:quota-available-bytes>")
            except OSError:
                pass
        return "<D:propstat><D:prop>" + "".join(props) + "</D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat>"

    def requested_props(self):
        body = self.body_text()
        if not body.strip():
            return None
        try:
            root = ET.fromstring(body)
        except ET.ParseError:
            return None
        ns = {"D": DAV_NS}
        if root.find(".//D:allprop", ns) is not None:
            return "allprop"
        if root.find(".//D:propname", ns) is not None:
            return "propname"
        names = []
        for el in root.findall(".//D:prop/*", ns):
            tag = el.tag.split("}")[-1]
            names.append(tag)
        return names or None

    def multistatus(self, rel, fs, depth):
        items = [(rel, fs)]
        if depth >= 1 and os.path.isdir(fs):
            try:
                for name in sorted(os.listdir(fs)):
                    if name.startswith("."):
                        continue
                    child = os.path.join(fs, name)
                    crel = (rel.rstrip("/") + "/" + name) or "/" + name
                    items.append((crel, child))
            except OSError:
                pass
        out = ['<?xml version="1.0" encoding="utf-8"?>', '<D:multistatus xmlns:D="DAV:">']
        for crel, cfs in items:
            if not os.path.exists(cfs):
                continue
            out.append("<D:response>")
            out.append(f"<D:href>{self.href(crel, os.path.isdir(cfs))}</D:href>")
            out.append(self.propstat(crel, cfs))
            out.append("</D:response>")
        out.append("</D:multistatus>")
        return "".join(out)

    # ---------- methods ----------

    def do_OPTIONS(self):
        self.read_body()
        self.send_body(200, b"", "text/plain", {
            "Allow": "OPTIONS, PROPFIND, PROPPATCH, GET, HEAD, PUT, DELETE, MKCOL, COPY, MOVE, LOCK, UNLOCK",
        })

    def do_PROPFIND(self):
        if not self.require_auth():
            return
        self.read_body()
        rel, _ = self.dav_path()
        try:
            fs = self.fs_path(rel)
        except ValueError:
            self.send_body(400, "bad path\n", "text/plain")
            return
        if not os.path.exists(fs):
            self.send_body(404, "not found\n", "text/plain")
            return
        depth = self.headers.get("Depth", "1").lower()
        depth = 0 if depth == "0" else 1
        body = self.multistatus(rel, fs, depth)
        self.send_body(207, body)

    def do_PROPPATCH(self):
        if not self.require_auth():
            return
        self.read_body()
        rel, _ = self.dav_path()
        out = (
            '<?xml version="1.0" encoding="utf-8"?>'
            '<D:multistatus xmlns:D="DAV:">'
            f"<D:response><D:href>{self.href(rel, os.path.isdir(self.fs_path(rel)))}</D:href>"
            "<D:propstat><D:prop/><D:status>HTTP/1.1 200 OK</D:status></D:propstat>"
            "</D:response></D:multistatus>"
        )
        self.send_body(207, out)

    def do_HEAD(self):
        if not self.require_auth():
            return
        self.read_body()
        rel, _ = self.dav_path()
        try:
            fs = self.fs_path(rel)
        except ValueError:
            self.send_body(400, "bad path\n", "text/plain")
            return
        if not os.path.exists(fs):
            self.send_body(404, "", "text/plain")
            return
        st = os.stat(fs)
        if os.path.isdir(fs):
            self.send_body(200, b"", "text/html; charset=utf-8")
        else:
            self.send_response(200)
            self.send_header("Content-Type", "application/octet-stream")
            self.send_header("Content-Length", str(st.st_size))
            self.send_header("ETag", etag(rel, st))
            self.send_header("Last-Modified", http_date(st.st_mtime))
            self.end_headers()

    def do_GET(self):
        if not self.require_auth():
            return
        self.read_body()
        rel, _ = self.dav_path()
        try:
            fs = self.fs_path(rel)
        except ValueError:
            self.send_body(400, "bad path\n", "text/plain")
            return
        if not os.path.exists(fs):
            self.send_body(404, "not found\n", "text/plain")
            return
        if os.path.isdir(fs):
            # simple listing so `curl` is useful for debugging
            rows = "".join(
                f"<li><a href='{self.href(rel.rstrip('/') + '/' + n, os.path.isdir(os.path.join(fs, n)))}'>{n}</a></li>"
                for n in sorted(os.listdir(fs))
            )
            self.send_body(200, f"<html><body><ul>{rows}</ul></body></html>", "text/html; charset=utf-8")
            return
        with open(fs, "rb") as f:
            data = f.read()
        self.send_body(200, data, "application/octet-stream")

    def do_PUT(self):
        if not self.require_auth():
            return
        rel, _ = self.dav_path()
        try:
            fs = self.fs_path(rel)
        except ValueError:
            self.send_body(400, "bad path\n", "text/plain")
            return
        if os.path.isdir(fs):
            self.send_body(405, "", "text/plain")
            return
        os.makedirs(os.path.dirname(fs), exist_ok=True)
        length = int(self.headers.get("Content-Length") or 0)
        with open(fs, "wb") as f:
            remaining = length
            while remaining > 0:
                chunk = self.rfile.read(min(remaining, 65536))
                if not chunk:
                    break
                f.write(chunk)
                remaining -= len(chunk)
        st = os.stat(fs)
        self.send_body(201, b"", None, {
            "ETag": etag(rel, st),
            "Content-Length": "0",
        })

    def do_DELETE(self):
        if not self.require_auth():
            return
        self.read_body()
        rel, _ = self.dav_path()
        try:
            fs = self.fs_path(rel)
        except ValueError:
            self.send_body(400, "bad path\n", "text/plain")
            return
        if not os.path.exists(fs):
            self.send_body(404, "not found\n", "text/plain")
            return
        if rel in ("/", ""):
            self.send_body(403, "cannot delete root\n", "text/plain")
            return
        if os.path.isdir(fs):
            shutil.rmtree(fs)
        else:
            os.remove(fs)
        with LOCKS_LOCK:
            LOCKS.pop(rel, None)
        self.send_body(204, b"", None)

    def do_MKCOL(self):
        if not self.require_auth():
            return
        self.read_body()
        rel, _ = self.dav_path()
        try:
            fs = self.fs_path(rel)
        except ValueError:
            self.send_body(400, "bad path\n", "text/plain")
            return
        if os.path.exists(fs):
            self.send_body(405, "already exists\n", "text/plain")
            return
        os.makedirs(fs, exist_ok=True)
        self.send_body(201, b"", None)

    def do_COPY(self):
        if not self.require_auth():
            return
        self._copy_or_move(move=False)

    def do_MOVE(self):
        if not self.require_auth():
            return
        self._copy_or_move(move=True)

    def _copy_or_move(self, move):
        if not self.require_auth():
            return
        self.read_body()
        src_rel, _ = self.dav_path()
        dest = self.headers.get("Destination", "")
        if not dest:
            self.send_body(400, "missing Destination\n", "text/plain")
            return
        dpath = unquote(urlsplit(dest).path)
        if dpath.startswith(PREFIX):
            dpath = dpath[len(PREFIX):]
        drel = dpath or "/"
        try:
            src = self.fs_path(src_rel)
            dst = self.fs_path(drel)
        except ValueError:
            self.send_body(400, "bad path\n", "text/plain")
            return
        if not os.path.exists(src):
            self.send_body(404, "not found\n", "text/plain")
            return
        overwrite = self.headers.get("Overwrite", "T").upper() != "F"
        if os.path.exists(dst) and overwrite:
            if os.path.isdir(dst):
                shutil.rmtree(dst)
            else:
                os.remove(dst)
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        if move:
            shutil.move(src, dst)
        elif os.path.isdir(src):
            shutil.copytree(src, dst)
        else:
            shutil.copy2(src, dst)
        self.send_body(201 if not os.path.exists(dst) else 204, b"", None)

    def do_LOCK(self):
        if not self.require_auth():
            return
        rel, _ = self.dav_path()
        body = self.body_text()
        try:
            fs = self.fs_path(rel)
        except ValueError:
            self.send_body(400, "bad path\n", "text/plain")
            return
        with LOCKS_LOCK:
            token = LOCKS.get(rel)
            if token and self.headers.get("If"):
                # refresh
                pass
            elif token:
                self.send_body(423, "locked\n", "text/plain")
                return
            else:
                token = "opaquelocktoken:" + str(uuid.uuid4())
                LOCKS[rel] = token
        timeout = self.headers.get("Timeout", "Second-3600")
        xml = (
            '<?xml version="1.0" encoding="utf-8"?>'
            '<D:prop xmlns:D="DAV:"><D:lockdiscovery><D:activelock>'
            "<D:locktype><D:write/></D:locktype>"
            "<D:lockscope><D:exclusive/></D:lockscope>"
            f"<D:depth>infinity</D:depth>"
            "<D:owner><D:href>stub</D:href></D:owner>"
            f"<D:timeout>{timeout}</D:timeout>"
            f"<D:locktoken><D:href>{token}</D:href></D:locktoken>"
            f"<D:lockroot><D:href>{self.href(rel, os.path.isdir(fs) if os.path.exists(fs) else False)}</D:href></D:lockroot>"
            "</D:activelock></D:lockdiscovery></D:prop>"
        )
        if os.path.isdir(fs):
            self.send_body(200, xml, None, {"Lock-Token": f"<{token}>"})
        else:
            self.send_body(201, xml, None, {"Lock-Token": f"<{token}>"})

    def do_UNLOCK(self):
        if not self.require_auth():
            return
        rel, _ = self.dav_path()
        token = (self.headers.get("Lock-Token") or "").strip("<> ")
        with LOCKS_LOCK:
            if token and LOCKS.get(rel) == token:
                del LOCKS[rel]
        self.send_body(204, b"", None)


class StubServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, addr, handler, root, user, password):
        super().__init__(addr, handler)
        self.root = root
        self.user = user
        self.password = password


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--port", type=int, default=18888)
    ap.add_argument("--bind", default="127.0.0.1")
    ap.add_argument("--user", default="admin")
    ap.add_argument("--password", default="clouddisk")
    ap.add_argument("--root", default="")
    args = ap.parse_args()

    root = args.root or tempfile.mkdtemp(prefix="clouddisk-webdav-")
    os.makedirs(root, exist_ok=True)
    os.makedirs(os.path.join(root, "示例文件夹"), exist_ok=True)
    with open(os.path.join(root, "hello.txt"), "w", encoding="utf-8") as f:
        f.write("Hello from the CloudDisk WebDAV stub.\n")

    srv = StubServer((args.bind, args.port), Handler, root, args.user, args.password)
    sys.stderr.write(
        f"[stub] WebDAV root {root}\n"
        f"[stub] http://{args.bind}:{args.port}{PREFIX}  user={args.user} password={args.password}\n"
    )
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        srv.server_close()


if __name__ == "__main__":
    main()
