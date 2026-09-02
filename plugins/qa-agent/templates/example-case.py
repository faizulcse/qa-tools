"""Example API test case. Copy into qa-workspace/cases/ and adapt.

    python3 cases/TC-20.py
"""

import os
import sys

sys.path.insert(0, os.path.join(os.environ.get("CLAUDE_PLUGIN_ROOT", "."), "scripts"))
from api_harness import ApiCase  # noqa: E402

BASE = os.environ["QA_API_URL"]
AUTH = {"Authorization": f"Bearer {os.environ['QA_TOKEN']}"}

with ApiCase("TC-20", "Expired discount code returns 422 with a typed error",
             base_url=BASE, headers=AUTH) as c:

    r = c.post("/v1/cart/discount", json_body={"code": "OLD2019"})

    c.check_status(r, 422)
    c.check_json(r, "error.code", "DISCOUNT_EXPIRED")
    c.check_schema(r, {"error": {"code": str, "message": str}})
    c.check_under_ms(r, 1000)

    # the cart must not have been modified by the rejected request
    cart = c.get("/v1/cart")
    c.check_status(cart, 200)
    c.check_json(cart, "total", 12000)          # cents
    c.check_absent(cart, "discount", "internal_notes")


with ApiCase("TC-21", "Another user's cart is not readable",
             base_url=BASE, headers=AUTH) as c:
    r = c.get("/v1/cart/00000000-0000-0000-0000-000000000999")
    c.check_status(r, [403, 404])
    c.check_absent(r, "items", "total")         # no leakage in the error body
