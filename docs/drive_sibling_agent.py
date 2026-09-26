#!/usr/bin/env python3
import json
import subprocess
import sys
import time

def run_cmd(cmd, check=True):
    print(f"+ {' '.join(cmd)}")
    res = subprocess.run(cmd, capture_output=True, text=True)
    if check and res.returncode != 0:
        print(f"Command failed (exit {res.returncode}):\n{res.stderr}\n{res.stdout}", file=sys.stderr)
        raise RuntimeError(f"Command failed: {cmd}")
    return res

def get_current_pane_and_sibling():
    # Fetch panes from herdr
    res = run_cmd(["herdr", "pane", "list", "--json"] if False else ["herdr", "pane", "list"])
    data = json.loads(res.stdout)
    panes = data.get("result", {}).get("panes", [])
    
    current_pane_id = None
    # We can check HERDR_PANE_ID env var or find the pane matching current working agent
    import os
    env_pane = os.environ.get("HERDR_PANE_ID")
    
    current_tab = None
    for p in panes:
        if env_pane and p.get("pane_id") == env_pane:
            current_tab = p.get("tab_id")
            current_pane_id = env_pane
            break
            
    if not current_tab:
        # Fallback to finding pane in wK:t3
        current_tab = "wK:t3"
        current_pane_id = env_pane or "wK:pK"
        
    print(f"Current Pane: {current_pane_id}, Current Tab: {current_tab}")
    
    sibling = None
    for p in panes:
        if p.get("tab_id") == current_tab and p.get("pane_id") != current_pane_id:
            sibling = p
            break
            
    if not sibling:
        raise RuntimeError(f"No sibling pane found in tab {current_tab}")
        
    sibling_id = sibling.get("pane_id")
    print(f"Found sibling pane: {sibling_id} (Agent: {sibling.get('agent')}, Status: {sibling.get('agent_status')})")
    return sibling_id

def wait_until_idle(target, timeout_sec=15):
    start = time.time()
    while time.time() - start < timeout_sec:
        res = subprocess.run(["herdr", "agent", "get", target], capture_output=True, text=True)
        if res.returncode == 0:
            try:
                info = json.loads(res.stdout)
                status = info.get("result", {}).get("agent", {}).get("agent_status")
                if status in ("idle", "done"):
                    return status
            except Exception:
                pass
        time.sleep(1)
    return "timeout"

def main():
    target = get_current_pane_and_sibling()
    
    print("\n--- Step 1: Clearing session (/clear) ---")
    # Send /clear to the sibling agent
    # We use agent prompt without --wait because /clear is an internal command
    res = subprocess.run(["herdr", "agent", "prompt", target, "/clear"], capture_output=True, text=True)
    print(f"Prompt /clear output:\n{res.stdout}\n{res.stderr}")
    time.sleep(2)
    wait_until_idle(target, 10)
    
    print("\n--- Step 2: Setting model (/model Grok 4.7 low) ---")
    res = subprocess.run(["herdr", "agent", "prompt", target, "/model Grok 4.7 low"], capture_output=True, text=True)
    print(f"Prompt /model output:\n{res.stdout}\n{res.stderr}")
    time.sleep(2)
    wait_until_idle(target, 10)
    
    print("\n--- Step 3: Sending prompt 'hi' and waiting for completion ---")
    # Prompt with --wait and timeout of 120s
    res = subprocess.run(["herdr", "agent", "prompt", target, "hi", "--wait", "--timeout", "120000"], capture_output=True, text=True)
    print(f"Prompt 'hi' result (exit {res.returncode}):\n{res.stdout}\n{res.stderr}")
    
    print("\n--- Step 4: Reading response from sibling agent ---")
    res = run_cmd(["herdr", "agent", "read", target, "--source", "recent-unwrapped", "--lines", "40"])
    print("=== SIBLING AGENT OUTPUT ===")
    print(res.stdout)
    
    # Also inspect final status
    status_res = run_cmd(["herdr", "agent", "get", target])
    print("=== FINAL STATUS ===")
    print(status_res.stdout)

if __name__ == "__main__":
    main()
