import os
import re
import sys
import threading
import time
import subprocess
from app import app, store

def test_api():
    client = app.test_client()

    # 1. Locked GET /api/gst returns 401
    r = client.get('/api/gst')
    assert r.status_code == 401, f"Expected 401, got {r.status_code}"
    print("[PASS] Locked: GET /api/gst returns 401")

    # Unlock session
    with client.session_transaction() as sess:
        sess['unlocked'] = True

    # 2. Reject invalid GSTIN "ABC123"
    r = client.post('/api/gst', json={'gstin': 'ABC123'})
    assert r.status_code == 400
    print("[PASS] GSTIN 'ABC123' rejected with status 400")

    # 3. Reject rate 50
    r = client.post('/api/gst', json={'gst_rates': {'aata': 50}})
    assert r.status_code == 400
    print("[PASS] Rate 50 is rejected with status 400")

    # 4. Accept valid GSTIN "27ABCDE1234F1Z5" and rate 5
    r = client.post('/api/gst', json={
        'gst_enabled': True,
        'gstin': '27ABCDE1234F1Z5',
        'gst_rates': {'aata': 5},
        'interstate': False
    })
    assert r.status_code == 200
    data = r.get_json()
    assert data['gstin'] == '27ABCDE1234F1Z5'
    assert data['gst_rates'] == {'aata': 5.0}
    print("[PASS] GSTIN '27ABCDE1234F1Z5' is accepted and rate aata=5 saved")

    # 5. Rate 0 is accepted
    r = client.post('/api/gst', json={'gst_rates': {'namak': 0}})
    assert r.status_code == 200
    print("[PASS] A line with rate 0: accepted, no tax, no error")

if __name__ == "__main__":
    test_api()
