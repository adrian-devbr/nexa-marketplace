(function () {
    const keys = {
        users: "nexa.users.v1",
        session: "nexa.session.v1",
        listings: "nexa.listings.v1",
        favorites: "nexa.favorites.v1"
    };

    function readList(key) {
        const value = localStorage.getItem(key);

        if (value === null) {
            return [];
        }

        const parsed = JSON.parse(value);

        if (!Array.isArray(parsed)) {
            throw new Error(`Os dados locais de "${key}" estão inválidos.`);
        }

        return parsed;
    }

    function writeList(key, value) {
        localStorage.setItem(key, JSON.stringify(value));
    }

    function readFavorites() {
        const value = localStorage.getItem(keys.favorites);

        if (value === null) {
            return {};
        }

        const parsed = JSON.parse(value);

        if (
            !parsed ||
            typeof parsed !== "object" ||
            Array.isArray(parsed) ||
            Object.values(parsed).some(
                (ids) => !Array.isArray(ids) || ids.some((id) => typeof id !== "string")
            )
        ) {
            throw new Error("Os favoritos locais estão inválidos.");
        }

        return parsed;
    }

    window.NEXAStore = Object.freeze({
        users: {
            getAll: () => readList(keys.users),
            save: (users) => writeList(keys.users, users)
        },
        listings: {
            getAll: () => readList(keys.listings),
            save: (listings) => writeList(keys.listings, listings)
        },
        favorites: {
            getAll: (userId) => readFavorites()[userId] ?? [],
            toggle: (userId, itemId) => {
                const favorites = readFavorites();
                const ids = new Set(favorites[userId] ?? []);
                const removing = ids.has(itemId);

                if (removing) {
                    ids.delete(itemId);
                } else {
                    ids.add(itemId);
                }

                favorites[userId] = [...ids];
                localStorage.setItem(keys.favorites, JSON.stringify(favorites));
                return !removing;
            }
        },
        session: {
            get: () => {
                const value = localStorage.getItem(keys.session);
                return value === null ? null : JSON.parse(value);
            },
            set: (session) => localStorage.setItem(keys.session, JSON.stringify(session)),
            clear: () => localStorage.removeItem(keys.session)
        }
    });
})();
