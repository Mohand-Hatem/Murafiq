# Murafiq — Errors & Response Format Reference

This document defines the HTTP status code contract, validation formatting, and the global response envelope for all Murafiq API endpoints.

---

## 1. Response Envelope Contract

Every response returned by the API adheres to the standard `ApiResponse` structure:

### Success Response (`200 OK`, `201 Created`)
```json
{
  "success": true,
  "message": "Operation completed successfully",
  "data": {
    "id": "60f719b8f1a2c81234567890",
    "name": "Sarah Ahmed"
  },
  "meta": {
    "total": 50,
    "page": 1,
    "limit": 10,
    "totalPages": 5
  }
}
```
*(The `meta` field is present on paginated list endpoints and omitted on single-resource operations).*

---

### Error Response (`4xx Client Error`, `5xx Server Error`)
```json
{
  "success": false,
  "message": "Human-readable error explanation",
  "errors": [
    {
      "field": "body.hourlyRate",
      "message": "Expected number, received string"
    }
  ]
}
```

---

## 2. HTTP Status Code Conventions

| Status Code | Reason / Semantic Meaning | Common Triggers |
|---|---|---|
| **`200 OK`** | Request succeeded. | Standard `GET`, `PATCH`, `DELETE` operations. |
| **`201 Created`** | New resource successfully created. | `POST /auth/register`, `POST /requests`, `POST /payouts/admin/batch`. |
| **`400 Bad Request`** | Malformed input, failed Zod validation, or business precondition failed. | Unrecognized body parameters (strict schema), missing required fields, attempting to check in before session date, filing a dispute after 48h window. |
| **`401 Unauthorized`** | Authentication required or token invalid/expired. | Missing `Bearer` header, expired access token, password changed after token issuance. |
| **`403 Forbidden`** | Authenticated user lacks permission for this action. | Client accessing stylist-only endpoint, non-participant accessing booking detail, operator attempting dispute resolution, exceeding daily request cap. |
| **`404 Not Found`** | Resource does not exist. | Invalid booking ID, user not found, uncompleted stylist profile. |
| **`409 Conflict`** | State conflict or resource duplicate key. | Duplicate schedule block (double-booking attempt), duplicate offer on request, marking already-paid payout as paid, filing dispute on already-disputed booking. |
| **`429 Too Many Requests`** | Rate limit exceeded. | Exceeding 100 requests / 15m globally, exceeding 5 login attempts / 15m, OTP resend spam. |
| **`500 Internal Server Error`** | Unhandled server exception. | Uncaught database or runtime error. |
| **`502 Bad Gateway`** | External service failure. | Email gateway unreachable, Paymob webhook failure. |

---

## 3. Strict Schema Validation

All Zod schemas chain `.strict()` across `body`, `params`, and `query`:
- Sending extra unrecognized keys in request bodies or query parameters produces an immediate `400 Bad Request` listing the unrecognized field.
