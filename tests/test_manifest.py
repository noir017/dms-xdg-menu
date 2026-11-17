import json
import os
import re
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REQUIRED = ["id", "name", "description", "version", "author", "type", "capabilities", "component"]


def load(*parts):
    with open(os.path.join(ROOT, *parts), encoding="utf-8") as f:
        return json.load(f)


class ManifestTest(unittest.TestCase):
    def test_plugin_json(self):
        manifest = load("plugin.json")
        for key in REQUIRED:
            self.assertIn(key, manifest)
        self.assertEqual(manifest["id"], "xdgMenu")
        self.assertRegex(manifest["version"], r"^\d+\.\d+\.\d+$")
        self.assertTrue(os.path.isfile(os.path.join(ROOT, manifest["component"])))

    def test_translations(self):
        directory = os.path.join(ROOT, "translations")
        files = [name for name in os.listdir(directory) if name.endswith(".json")]
        self.assertTrue(files)
        for name in files:
            with self.subTest(name):
                table = load("translations", name)
                for context, terms in table.items():
                    self.assertIsInstance(terms, dict)
                    for term, text in terms.items():
                        self.assertIsInstance(text, str)
                        self.assertTrue(text)

    def test_translated_terms_are_used(self):
        with open(os.path.join(ROOT, "XdgMenu.qml"), encoding="utf-8") as f:
            used = set(re.findall(r'I18n\.trFor\("xdgMenu", "([^"]+)"\)', f.read()))
        for name in os.listdir(os.path.join(ROOT, "translations")):
            with self.subTest(name):
                self.assertEqual(set(load("translations", name)), used)


if __name__ == "__main__":
    unittest.main()
