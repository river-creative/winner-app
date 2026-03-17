# EZ Texting API Response Reference

## Send Message Response

**Endpoint:** `POST https://a.eztexting.com/v1/messages`

**Response:**
```json
{
  "id": "272199890003"
}
```

**Frontend path:** `result.data.id` (backend wraps in `data` property)

---

## Message Report Response

**Endpoint:** `GET https://a.eztexting.com/v1/message-reports/{id}`

**Response:**
```json
{
  "delivery": {
    "bounced": {
      "label": "Bounced",
      "data": 0,
      "percentage": 0
    },
    "queued": {
      "label": "Queued",
      "data": 0,
      "percentage": 0
    },
    "total_delivered": {
      "label": "Delivered",
      "data": 1,
      "percentage": 100
    },
    "total_not_sent": {
      "label": "Not Sent",
      "data": 0,
      "percentage": 0
    }
  },
  "engagement": {
    "no_action": {
      "label": "No Action",
      "data": 1,
      "percentage": 100
    },
    "opted_out": {
      "label": "Opted Out",
      "data": 0,
      "percentage": 0
    },
    "replied": {
      "label": "Replied",
      "data": 0,
      "percentage": 0
    }
  },
  "links": []
}
```

**Frontend paths:**
- Delivered: `result.data.delivery.total_delivered.data > 0`
- Bounced: `result.data.delivery.bounced.data > 0`
- Not Sent: `result.data.delivery.total_not_sent.data > 0`
- Queued: `result.data.delivery.queued.data > 0`
- Opted Out: `result.data.engagement.opted_out.data > 0`
- Replied: `result.data.engagement.replied.data > 0`

---

## Status Mapping

| EZ Texting Field | App Status |
|------------------|------------|
| `total_delivered.data > 0` | `delivered` |
| `bounced.data > 0` | `bounced` |
| `total_not_sent.data > 0` | `failed` |
| `queued.data > 0` | `queued` |
| none of above | `sent` |

---

## Notes

- Backend wraps EZ Texting response in: `{ success, statusCode, data: <eztexting_response>, rawResponse }`
- Authentication: Basic Auth with `EZ_TEXTING_USERNAME` and `EZ_TEXTING_PASSWORD`
- API Base: `https://a.eztexting.com/v1`
