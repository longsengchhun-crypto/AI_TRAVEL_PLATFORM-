// OpenAPI 3.0 document, built from a compact endpoint table so docs and routes stay reviewable in one place.
type Auth = "none" | "optional" | "user" | "staff" | "admin" | "partner" | "signature";
interface Ep { m: "get" | "post" | "patch" | "put" | "delete"; p: string; tag: string; s: string; auth: Auth; q?: string[]; body?: Record<string, string>; codes?: number[] }

const E: Ep[] = [
  { m: "get", p: "/health", tag: "System", s: "Service and database health", auth: "none" },
  { m: "get", p: "/meta", tag: "Discovery", s: "Currencies (sample rates), amenities, destination list", auth: "none" },
  { m: "get", p: "/home", tag: "Discovery", s: "Homepage content: featured, trending, hotels, itineraries, categories", auth: "none" },
  { m: "get", p: "/destinations", tag: "Destinations", s: "List destinations with filters and pagination", auth: "none", q: ["q", "country", "tag", "international", "featured", "sort", "page", "pageSize"] },
  { m: "get", p: "/destinations/{id}", tag: "Destinations", s: "Destination detail by id or slug", auth: "none", codes: [404] },
  { m: "get", p: "/destinations/{id}/attractions", tag: "Destinations", s: "Attractions, activities and restaurants of a destination", auth: "none", q: ["kind", "category", "q", "familyFriendly", "sort", "page", "pageSize"] },
  { m: "get", p: "/destinations/{id}/accommodations", tag: "Destinations", s: "Accommodation search scoped to a destination", auth: "none" },
  { m: "get", p: "/attractions", tag: "Attractions", s: "Search attractions across destinations", auth: "none", q: ["destination", "kind", "category", "q", "page", "pageSize"] },
  { m: "get", p: "/attractions/{id}", tag: "Attractions", s: "Attraction detail", auth: "none", codes: [404] },
  { m: "get", p: "/accommodations", tag: "Accommodation", s: "Search accommodation with real availability and price filtering",
    auth: "optional", q: ["destination", "q", "checkIn", "checkOut", "adults", "children", "rooms", "minPrice", "maxPrice", "stars", "minRating", "amenities", "type", "freeCancellation", "breakfast", "familyFriendly", "lat", "lng", "maxDistanceKm", "sort", "page", "pageSize"], codes: [422] },
  { m: "get", p: "/accommodations/{id}", tag: "Accommodation", s: "Property detail with room types and optional stay quotes", auth: "none", q: ["checkIn", "checkOut", "rooms"], codes: [404, 422] },
  { m: "get", p: "/accommodations/{id}/availability", tag: "Accommodation", s: "Per-room availability and price breakdown for dates", auth: "none", q: ["checkIn", "checkOut", "rooms"], codes: [422] },
  { m: "get", p: "/room-types/{id}", tag: "Accommodation", s: "Room type detail (+quote when dates given)", auth: "none", codes: [404] },
  { m: "get", p: "/accommodations/{id}/reviews", tag: "Reviews", s: "Published reviews", auth: "none", q: ["page", "pageSize"] },
  { m: "post", p: "/accommodations/{id}/reviews", tag: "Reviews", s: "Submit a review (guests with a confirmed booking only)", auth: "user", body: { rating: "int 1-5", title: "string", body: "string" }, codes: [401, 403, 409, 422] },
  { m: "post", p: "/auth/register", tag: "Auth", s: "Create a customer account", auth: "none", body: { email: "string", password: "string (>=10, letters+digit)", name: "string" }, codes: [409, 422, 429] },
  { m: "post", p: "/auth/login", tag: "Auth", s: "Sign in; returns access + refresh tokens", auth: "none", body: { email: "string", password: "string" }, codes: [401, 429] },
  { m: "post", p: "/auth/refresh", tag: "Auth", s: "Rotate refresh token", auth: "none", body: { refreshToken: "string" }, codes: [401] },
  { m: "post", p: "/auth/logout", tag: "Auth", s: "Revoke refresh token", auth: "none", body: { refreshToken: "string" } },
  { m: "post", p: "/auth/forgot-password", tag: "Auth", s: "Start password reset (demo token returned only in non-production without email provider)", auth: "none", body: { email: "string" } },
  { m: "post", p: "/auth/reset-password", tag: "Auth", s: "Complete password reset", auth: "none", body: { token: "string", password: "string" }, codes: [400] },
  { m: "get", p: "/users/me", tag: "Account", s: "Current profile", auth: "user", codes: [401] },
  { m: "patch", p: "/users/me", tag: "Account", s: "Update profile", auth: "user", body: { name: "string?", phone: "string?", preferredCurrency: "string?" } },
  { m: "post", p: "/users/me/delete", tag: "Account", s: "Delete (anonymise) own account", auth: "user", body: { password: "string" }, codes: [403, 409] },
  { m: "get", p: "/wishlist", tag: "Account", s: "Saved destinations, hotels and places", auth: "user" },
  { m: "put", p: "/wishlist/{kind}/{id}", tag: "Account", s: "Save an item", auth: "user" },
  { m: "delete", p: "/wishlist/{kind}/{id}", tag: "Account", s: "Remove a saved item", auth: "user" },
  { m: "get", p: "/search-history", tag: "Account", s: "Recent searches", auth: "user" },
  { m: "get", p: "/users/me/reviews", tag: "Account", s: "Own review history", auth: "user" },
  { m: "get", p: "/notifications", tag: "Notifications", s: "In-app notifications", auth: "user" },
  { m: "patch", p: "/notifications/{id}/read", tag: "Notifications", s: "Mark read", auth: "user" },
  { m: "post", p: "/bookings/quote", tag: "Bookings", s: "Price a stay without holding inventory", auth: "user", body: { roomTypeId: "uuid", checkIn: "date", checkOut: "date", rooms: "int" } },
  { m: "post", p: "/bookings", tag: "Bookings", s: "Create booking; atomically reserves inventory and holds the room until payment", auth: "user",
    body: { roomTypeId: "uuid", checkIn: "date", checkOut: "date", rooms: "int", adults: "int", children: "int", guestName: "string", guestEmail: "string" }, codes: [409, 422] },
  { m: "get", p: "/bookings", tag: "Bookings", s: "Own booking history", auth: "user", q: ["status"] },
  { m: "get", p: "/bookings/{id}", tag: "Bookings", s: "Booking detail with status history and payments (owner/partner/staff)", auth: "user", codes: [404] },
  { m: "post", p: "/bookings/{id}/cancel", tag: "Bookings", s: "Cancel according to the stored policy; releases inventory", auth: "user", codes: [404, 409] },
  { m: "get", p: "/bookings/{id}/receipt", tag: "Bookings", s: "Receipt (marked simulated for demo payments)", auth: "user", codes: [409] },
  { m: "post", p: "/payments/intent", tag: "Payments", s: "Create idempotent payment for a held booking", auth: "user", body: { bookingId: "uuid", idempotencyKey: "string (>=8)" }, codes: [404, 409] },
  { m: "get", p: "/payments/{id}", tag: "Payments", s: "Payment status and events", auth: "user" },
  { m: "post", p: "/payments/{id}/simulate", tag: "Payments", s: "DEMO ONLY: act as the payment provider (mock mode)", auth: "user", body: { outcome: "success|fail|cancel" }, codes: [403] },
  { m: "post", p: "/payments/webhook", tag: "Payments", s: "Provider webhook; HMAC-signed raw body (X-Wayfarer-Signature); duplicate events are ignored", auth: "signature", body: { id: "string", type: "payment.succeeded|payment.failed|payment.cancelled", payment_ref: "string", amount_usd: "number" }, codes: [401] },
  { m: "post", p: "/ai/travel-plan", tag: "AI", s: "Natural-language or structured trip request -> grounded, validated itinerary", auth: "optional", body: { prompt: "string?", structured: "object?", save: "boolean?" }, codes: [401, 422, 429] },
  { m: "post", p: "/ai/assistant", tag: "AI", s: "RAG travel Q&A with source references", auth: "optional", body: { question: "string", destination: "string?" }, codes: [429] },
  { m: "post", p: "/ai/recommendations", tag: "AI", s: "Rule-ranked place and stay recommendations", auth: "none", body: { destination: "string", interests: "string[]" } },
  { m: "get", p: "/ai/sources", tag: "AI", s: "Approved knowledge documents and chunk counts", auth: "none" },
  { m: "get", p: "/ai/status", tag: "AI", s: "Which AI mode is active (rules vs LLM)", auth: "none" },
  { m: "post", p: "/itineraries", tag: "Itineraries", s: "Create an empty itinerary", auth: "user" },
  { m: "get", p: "/itineraries", tag: "Itineraries", s: "Own itineraries", auth: "user" },
  { m: "get", p: "/itineraries/{id}", tag: "Itineraries", s: "Itinerary (own or curated template)", auth: "optional", codes: [404] },
  { m: "patch", p: "/itineraries/{id}", tag: "Itineraries", s: "Edit title/travellers and reorder, replace or remove stops; totals are recalculated", auth: "user", codes: [404, 422] },
  { m: "delete", p: "/itineraries/{id}", tag: "Itineraries", s: "Delete itinerary", auth: "user" },
  { m: "post", p: "/itineraries/{id}/generate", tag: "Itineraries", s: "Regenerate one day (body.day) or all days", auth: "user" },
  { m: "post", p: "/itineraries/{id}/recalculate", tag: "Itineraries", s: "Recompute cost estimate", auth: "user" },
  { m: "post", p: "/itineraries/{id}/copy", tag: "Itineraries", s: "Copy a template into own trips", auth: "user" },
  { m: "get", p: "/locations/search", tag: "Maps", s: "Search internal gazetteer of destinations and places", auth: "none", q: ["q"] },
  { m: "post", p: "/routes/estimate", tag: "Maps", s: "Labelled straight-line distance/time estimate + external navigation links", auth: "none", body: { points: "[{lat,lng,name?}]" } },
  { m: "get", p: "/admin/overview", tag: "Admin", s: "Counts, bookings by status, simulated revenue, AI usage", auth: "staff", codes: [401, 403] },
  { m: "get", p: "/admin/users", tag: "Admin", s: "Users", auth: "staff", q: ["q", "role", "page", "pageSize"] },
  { m: "patch", p: "/admin/users/{id}/role", tag: "Admin", s: "Change a user's role (admin only)", auth: "admin" },
  { m: "get", p: "/admin/bookings", tag: "Admin", s: "All bookings", auth: "staff", q: ["status", "q", "page", "pageSize"] },
  { m: "get", p: "/admin/bookings/{id}", tag: "Admin", s: "Booking detail", auth: "staff" },
  { m: "post", p: "/admin/bookings/{id}/cancel", tag: "Admin", s: "Cancel any booking", auth: "staff" },
  { m: "post", p: "/admin/bookings/{id}/transition", tag: "Admin", s: "Mark CHECKED_IN or COMPLETED", auth: "staff" },
  { m: "get", p: "/admin/payments", tag: "Admin", s: "Payment ledger", auth: "staff", q: ["status", "page", "pageSize"] },
  { m: "get", p: "/admin/audit-logs", tag: "Admin", s: "Audit trail", auth: "staff", q: ["action", "page", "pageSize"] },
  { m: "get", p: "/admin/reviews", tag: "Admin", s: "Review moderation queue", auth: "staff" },
  { m: "patch", p: "/admin/reviews/{id}", tag: "Admin", s: "Publish or hide a review", auth: "staff" },
  { m: "get", p: "/admin/ai-usage", tag: "Admin", s: "AI call log", auth: "staff" },
  { m: "post", p: "/admin/destinations", tag: "Admin", s: "Create destination", auth: "staff", codes: [409, 422] },
  { m: "patch", p: "/admin/destinations/{id}", tag: "Admin", s: "Update destination", auth: "staff" },
  { m: "delete", p: "/admin/destinations/{id}", tag: "Admin", s: "Soft-delete destination", auth: "admin" },
  { m: "post", p: "/admin/accommodations", tag: "Admin", s: "Create accommodation with room types", auth: "staff" },
  { m: "put", p: "/admin/room-types/{id}/inventory", tag: "Admin", s: "Open or change nightly inventory/price for a date range", auth: "staff", body: { from: "date", to: "date", units: "int", priceUsd: "number?" } },
  { m: "get", p: "/partner/accommodations", tag: "Partner", s: "Properties the partner owns", auth: "partner" },
  { m: "get", p: "/partner/bookings", tag: "Partner", s: "Bookings for owned properties", auth: "partner" },
  { m: "post", p: "/partner/bookings/{id}/transition", tag: "Partner", s: "Check-in or complete a stay", auth: "partner" },
  { m: "put", p: "/partner/room-types/{id}/inventory", tag: "Partner", s: "Update availability/price for owned rooms", auth: "partner" },
  { m: "get", p: "/partner/analytics", tag: "Partner", s: "Occupancy and booking totals", auth: "partner" },
];

const ROLE: Record<Auth, string> = {
  none: "Public", optional: "Public (personalised when signed in)", user: "Any signed-in user", staff: "staff or admin",
  admin: "admin", partner: "partner (own properties) or admin", signature: "Provider HMAC signature",
};

const paths: Record<string, any> = {};
for (const e of E) {
  const params = [
    ...[...e.p.matchAll(/\{(\w+)\}/g)].map((m) => ({ name: m[1], in: "path", required: true, schema: { type: "string" } })),
    ...(e.q ?? []).map((n) => ({ name: n, in: "query", required: false, schema: { type: "string" } })),
  ];
  const responses: Record<string, any> = { "200": { description: "Success" } };
  if (e.m === "post" && !/(login|refresh|webhook|quote|travel-plan|assistant|recommend|simulate|forgot|reset|generate|recalc|estimate|transition|cancel)/.test(e.p)) responses["201"] = { description: "Created" };
  for (const c of e.codes ?? []) responses[String(c)] = { description: { 400: "Bad request", 401: "Unauthenticated / invalid token", 403: "Forbidden", 404: "Not found", 409: "Conflict (e.g. no availability, illegal transition)", 422: "Validation error", 429: "Rate limited" }[c] };
  if (e.auth !== "none" && e.auth !== "optional") { responses["401"] ??= { description: "Unauthenticated" }; if (["staff", "admin", "partner"].includes(e.auth)) responses["403"] ??= { description: "Forbidden" }; }
  responses["500"] = { description: "Internal error (no internals exposed)" };
  (paths[e.p] ??= {})[e.m] = {
    tags: [e.tag], summary: e.s, description: `Access: ${ROLE[e.auth]}`,
    security: e.auth === "none" || e.auth === "optional" || e.auth === "signature" ? [] : [{ bearerAuth: [] }],
    parameters: params,
    ...(e.body ? { requestBody: { required: true, content: { "application/json": { schema: { type: "object", properties: Object.fromEntries(Object.entries(e.body).map(([k, v]) => [k, { type: "string", description: v }])) } } } } } : {}),
    responses,
  };
}

export const openapi = {
  openapi: "3.0.3",
  info: {
    title: "WAYFARER API", version: "1.0.0",
    description: "REST API for the WAYFARER travel platform. Errors use { error: { code, message, details? } }. Demo payments are simulated and flagged as such.",
  },
  servers: [{ url: "/api" }],
  components: { securitySchemes: { bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" } } },
  paths,
};
