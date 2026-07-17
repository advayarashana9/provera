import os
import re
import pytest
from app.services.diff_service import FilingDiffService

def test_no_hardcoded_2023_presets():
    # Read AskProvera.tsx to verify that no preset prompts contain "2023"
    current_dir = os.path.dirname(os.path.abspath(__file__))
    workspace_root = os.path.abspath(os.path.join(current_dir, "../../../"))
    filepath = os.path.join(workspace_root, "web/src/app/company/[cik]/AskProvera.tsx")
    assert os.path.exists(filepath), f"{filepath} does not exist"
    
    with open(filepath, "r") as f:
        content = f.read()
        
    # Locate presets array
    presets_match = re.search(r"const presets = \[(.*?)\];", content, re.DOTALL)
    assert presets_match is not None, "Could not find presets array in AskProvera.tsx"
    
    presets_block = presets_match.group(1)
    assert "2023" not in presets_block, f"Found hardcoded 2023 in suggested presets block:\n{presets_block}"

def test_deterministic_similarity_percentage():
    # Verify that compare_texts_deterministically works deterministically
    ds = FilingDiffService()
    
    t1 = "This is a statement of assets and liabilities."
    t2 = "This is a statement of assets and liabilities."
    
    change, summary, old_exc, new_exc = ds.compare_texts_deterministically(t1, t2)
    assert change == "unchanged"
    
    t3 = "This is a modified statement of assets."
    change2, summary2, old_exc2, new_exc2 = ds.compare_texts_deterministically(t1, t3)
    assert change2 == "modified"

def test_empty_section_similarity():
    ds = FilingDiffService()
    change, summary, old_exc, new_exc = ds.compare_texts_deterministically("", "")
    assert change == "unchanged"
    assert "empty" in summary.lower()
