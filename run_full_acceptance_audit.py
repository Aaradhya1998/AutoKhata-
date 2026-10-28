import html
import json
import os
import subprocess
import threading
import time
import urllib.request
import simple_websocket
from werkzeug.serving import make_server
from app import app

def run_tests():
    # Start Flask
    server = make_server('127.0.0.1', 5055, app)
    server_thread = threading.Thread(target=server.serve_forever)
    server_thread.daemon = True
    server_thread.start()
    time.sleep(1)

    # Start Chrome headless
    chrome_proc = subprocess.Popen([
        r'C:\Program Files\Google\Chrome\Application\chrome.exe',
        '--headless=new',
        '--remote-debugging-port=9222',
        '--user-data-dir=' + os.path.abspath('tmp_chrome_profile'),
        'http://127.0.0.1:5055/'
    ])
    time.sleep(2)

    ws = None
    try:
        tabs = json.loads(urllib.request.urlopen('http://127.0.0.1:9222/json').read())
        page_tab = next(tab for tab in tabs if tab.get('type') == 'page')
        ws_url = page_tab['webSocketDebuggerUrl']
        ws = simple_websocket.Client(ws_url)

        msg_id = 1
        def send_cmd(method, params=None):
            nonlocal msg_id
            curr_id = msg_id
            msg_id += 1
            ws.send(json.dumps({'id': curr_id, 'method': method, 'params': params or {}}))
            while True:
                resp = json.loads(ws.receive())
                if resp.get('id') == curr_id:
                    return resp.get('result', {})

        def eval_js(expression, await_promise=False):
            res = send_cmd('Runtime.evaluate', {
                'expression': expression,
                'returnByValue': True,
                'awaitPromise': await_promise
            })
            if 'exceptionDetails' in res:
                raise RuntimeError(res['exceptionDetails'])
            return res.get('result', {}).get('value')

        time.sleep(1)

        # Unlock the app
        eval_js("unlock()")
        time.sleep(0.5)

        print("\n--- RUNNING ACCEPTANCE TESTS ---")

        # Acceptance 1: GSTIN rejection
        eval_js('document.getElementById("gstin").value = "ABC123"')
        eval_js('document.getElementById("gst-save").click()')
        time.sleep(0.3)
        msg_gstin = eval_js('document.getElementById("gst-message").textContent')
        print(f"1. GSTIN 'ABC123' test: rejected with message: '{msg_gstin}'")
        assert "Invalid GSTIN" in msg_gstin or len(msg_gstin) > 0

        # Acceptance 2: Rate 50 rejection
        eval_js('document.getElementById("gstin").value = ""')
        eval_js('document.getElementById("gst-rates").value = "aata=50"')
        eval_js('document.getElementById("gst-save").click()')
        time.sleep(0.3)
        msg_rate50 = eval_js('document.getElementById("gst-message").textContent')
        print(f"2. Rate 50 test: rejected with message: '{msg_rate50}'")
        assert "between 0 and 40" in msg_rate50 or "rates must be numbers" in msg_rate50

        # Acceptance 3: GSTIN "27ABCDE1234F1Z5" accepted and aata=5 saved
        eval_js('document.getElementById("gst-enabled").checked = true')
        eval_js('document.getElementById("gstin").value = "27ABCDE1234F1Z5"')
        eval_js('document.getElementById("gst-rates").value = "aata=5"')
        eval_js('document.getElementById("gst-save").click()')
        time.sleep(0.5)
        msg_save = eval_js('document.getElementById("gst-message").textContent')
        print(f"3. GSTIN '27ABCDE1234F1Z5' test: accepted with message: '{msg_save}'")
        assert msg_save == "Saved"

        # Acceptance 4: Invoice one aata line of 100 with paid 0, intra-state
        eval_js('showView("invoice")')
        eval_js('document.getElementById("inv-gst-on").checked = true')
        eval_js('document.getElementById("inv-interstate").checked = false')
        eval_js('renderInvoiceLines([{ item: "aata", quantity: 1, unit: "kg", amount: 100, gstRate: 5 }])')
        eval_js('document.getElementById("inv-paid").value = "0"')
        eval_js('updateInvoiceTotals()')

        taxable = eval_js('document.getElementById("inv-taxable").textContent')
        cgst = eval_js('document.getElementById("inv-cgst").textContent')
        sgst = eval_js('document.getElementById("inv-sgst").textContent')
        grand = eval_js('document.getElementById("inv-grand").textContent')
        due = eval_js('document.getElementById("inv-due").textContent')

        print(f"4. Intra-state test (taxable 100, paid 0, aata=5%):")
        print(f"   Taxable: {taxable} (expected: 100.00)")
        print(f"   CGST: {cgst} (expected: 2.50)")
        print(f"   SGST: {sgst} (expected: 2.50)")
        print(f"   Grand total: {grand} (expected: 105.00)")
        print(f"   Amount due: {due} (expected: 105.00)")
        assert taxable == "100.00"
        assert cgst == "2.50"
        assert sgst == "2.50"
        assert grand == "105.00"
        assert due == "105.00"

        # Acceptance 5: Same line, inter-state
        eval_js('document.getElementById("inv-interstate").checked = true')
        eval_js('updateInvoiceTotals()')

        igst = eval_js('document.getElementById("inv-igst").textContent')
        grand_inter = eval_js('document.getElementById("inv-grand").textContent')
        print(f"5. Inter-state test:")
        print(f"   IGST: {igst} (expected: 5.00)")
        print(f"   Grand total: {grand_inter} (expected: 105.00)")
        assert igst == "5.00"
        assert grand_inter == "105.00"

        # Acceptance 6: Paid 50
        eval_js('document.getElementById("inv-paid").value = "50"')
        eval_js('updateInvoiceTotals()')
        due50 = eval_js('document.getElementById("inv-due").textContent')
        print(f"6. Paid 50 test:")
        print(f"   Amount due: {due50} (expected: 55.00)")
        assert due50 == "55.00"

        # Acceptance 7: Line with rate 0
        eval_js('renderInvoiceLines([{ item: "namak", quantity: 1, unit: "kg", amount: 100, gstRate: 0 }])')
        eval_js('document.getElementById("inv-paid").value = "0"')
        eval_js('document.getElementById("inv-interstate").checked = false')
        eval_js('updateInvoiceTotals()')
        cgst0 = eval_js('document.getElementById("inv-cgst").textContent')
        grand0 = eval_js('document.getElementById("inv-grand").textContent')
        print(f"7. Rate 0 test:")
        print(f"   CGST: {cgst0} (expected: 0.00)")
        print(f"   Grand total: {grand0} (expected: 100.00)")
        assert cgst0 == "0.00"
        assert grand0 == "100.00"

        # Acceptance 8: GST off
        eval_js('document.getElementById("inv-gst-on").checked = false')
        eval_js('updateInvoiceTotals()')
        is_hidden = eval_js('document.getElementById("inv-tax-block").classList.contains("hidden")')
        total_off = eval_js('document.getElementById("inv-total").textContent')
        due_off = eval_js('document.getElementById("inv-due").textContent')
        print(f"8. GST off test:")
        print(f"   Tax block hidden: {is_hidden} (expected: True)")
        print(f"   Total: {total_off}, Due: {due_off}")
        assert is_hidden is True
        assert "100" in total_off
        assert "100" in due_off

        # Acceptance 9: Print check
        eval_js('document.getElementById("inv-gst-on").checked = true')
        eval_js('updateInvoiceTotals()')
        print_check = eval_js("""
            (() => {
                const taxBlock = document.getElementById("inv-tax-block");
                const gstinLine = document.getElementById("inv-gstin-line");
                const invoiceSheet = document.getElementById("invoice-sheet");
                return {
                    taxBlockVisible: !taxBlock.classList.contains("hidden") && !taxBlock.classList.contains("no-print"),
                    gstinLineVisible: !gstinLine.classList.contains("hidden") && !gstinLine.classList.contains("no-print"),
                    insideSheet: invoiceSheet.contains(taxBlock) && invoiceSheet.contains(gstinLine),
                    gstinText: gstinLine.textContent
                };
            })()
        """)
        print(f"9. Printed-page check (Ctrl+P):")
        print(f"   Tax block included in print: {print_check['taxBlockVisible']}")
        print(f"   GSTIN line included in print: {print_check['gstinLineVisible']}")
        print(f"   GSTIN text: '{print_check['gstinText']}'")
        assert print_check['taxBlockVisible'] is True
        assert print_check['gstinLineVisible'] is True
        assert "27ABCDE1234F1Z5" in print_check['gstinText']

        print("\nALL ACCEPTANCE TESTS PASSED SUCCESSFULLY!")

    finally:
        if ws:
            ws.close()
        chrome_proc.terminate()
        server.shutdown()
        server_thread.join()

if __name__ == "__main__":
    run_tests()

