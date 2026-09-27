/**
 * Spike (tapstone VR M1a Task 8): only local assets, so the page makes no network request after
 * load. The starter's stock CDN models (robot, desk, plant, banner) are removed.
 */
import { AssetType, defineAssets } from '@iwsdk/core';
const publicAssetUrl = (filePath) => `${import.meta.env.BASE_URL}${filePath.replace(/^\/+/u, '')}`;
export default defineAssets({
    'welcome-panel': {
        url: publicAssetUrl('ui/welcome.uikitml'),
        type: AssetType.UIKitML,
        name: 'Welcome Panel',
    },
});
