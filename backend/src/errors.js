export class HttpError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}

export function asyncRoute(handler) {
    return (request, response, next) => {
        Promise.resolve(handler(request, response, next)).catch(next);
    };
}

export function notify(db, { userId, type, title, body, resourceType, resourceId }) {
    return db.query(
        `INSERT INTO notifications
            (id, user_id, type, title, body, resource_type, resource_id)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6)`,
        [userId, type, title, body, resourceType ?? null, resourceId ?? null]
    );
}
