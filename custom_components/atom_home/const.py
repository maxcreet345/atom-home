"""Constants for Atom Home."""
DOMAIN = "atom_home"
PANEL_URL_PATH = "atom-home"
PANEL_TITLE = "Atom Home"
PANEL_ICON = "mdi:home-heart"
STATIC_URL = "/atom_home_static"
FRONTEND_FILE = "atom-home.js"
STORAGE_KEY = "atom_home.config"
STORAGE_VERSION = 1
MAX_CONFIG_BYTES = 512 * 1024
PHOTOS_URL = "/atom_home_photos"
PHOTOS_DIR = "atom_home/photos"
MAX_PHOTO_BYTES = 1536 * 1024
# A panel that preserves per-device setup fields (composition, layout, module binding, type) declares this on config/set.
CLIENT_FEATURE_COMPOSITION = "device_composition_v1"
# A panel that keeps rooms.<area>.feed (the Energy panel's apartment split) declares this; 1.18.0 and older drop the field on save.
CLIENT_FEATURE_ROOM_FEED = "room_feed_v1"
# A panel that keeps energy.tariffs (the Energy panel's price history) declares this; 1.24.0 and older drop the field on save.
CLIENT_FEATURE_TARIFF = "energy_tariff_v1"
WIZARD_DEVICE_FIELDS = ("type", "composition", "layout", "module")
