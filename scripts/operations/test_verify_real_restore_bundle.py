import hashlib
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest
from verify_real_restore_bundle import verify_tar, EXPECTED_FILES

def fake_archive(path, invalid_hash=False):
    files={name:b"SYNTHETIC TEST CONTENT" for name in EXPECTED_FILES
           if name not in ("SHA256SUMS","managed-coverage.json")}
    files["managed-coverage.json"]=json.dumps({"restoration_verified":False,
        "auth_tables_total":27,"ledger_tables_total":1}).encode()
    files["SHA256SUMS"]="".join(hashlib.sha256(data).hexdigest()+"  "+name+"\n"
      for name,data in sorted(files.items()) if name!="managed-coverage.json").encode()
    if invalid_hash: files["roles.sql"]=b"DIFFERENT FAKE TEST CONTENT"
    with tarfile.open(path,"w") as archive:
        for name,data in files.items():
            info=tarfile.TarInfo(name)
            info.size=len(data)
            archive.addfile(info,io.BytesIO(data))

class TestBundle(unittest.TestCase):
    def test_good_synthetic_checksum(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/"bundle.tar"
            fake_archive(p)
            dest=Path(d)/"extracted"
            verify_tar(p,dest)
            self.assertEqual({x.name for x in dest.iterdir()},EXPECTED_FILES)
    def test_detect_synthetic_checksum_corruption(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/"bundle.tar"
            fake_archive(p,invalid_hash=True)
            with self.assertRaisesRegex(ValueError,"SOURCE_HASH_MISMATCH"):
                verify_tar(p,Path(d)/"extracted")

if __name__=="__main__":
    unittest.main()
