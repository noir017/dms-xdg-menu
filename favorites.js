.pragma library

// Favorites are stored as desktop ids, in the order the user arranged them.

// The installed apps for the stored ids, in order; ids of removed apps are skipped.
function resolve(ids, apps) {
    const byId = {};
    for (const app of apps)
        byId[app.id] = app;
    return (ids || []).map(id => byId[id]).filter(app => app !== undefined);
}

function contains(ids, id) {
    return (ids || []).includes(id);
}

// Appends the id, or removes it when it is already a favorite.
function toggle(ids, id) {
    ids = ids || [];
    return ids.includes(id) ? ids.filter(other => other !== id) : ids.concat([id]);
}

// Applies a drag result. `shown` are the ids on screen and `order` lists their old
// positions in the new order. Ids that are not shown (removed apps) keep their slots.
function reorder(ids, shown, order) {
    const moved = order.map(index => shown[index]);
    let next = 0;
    return (ids || []).map(id => shown.includes(id) ? moved[next++] : id);
}
