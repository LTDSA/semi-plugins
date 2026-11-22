const fs = require('fs');
const path = require('path');

const sourceRoot = path.resolve(process.argv[2] || '');
if (!process.argv[2] || !fs.existsSync(sourceRoot)) {
    throw new Error('用法: node scripts/generate-mijia-sdk-api.cjs <miot-plugin-sdk/miot-sdk>');
}

const surfaces = {
    device: ['device/BasicDevice.js'],
    wifi: ['device/WifiDevice.js'],
    smarthome: ['service/smarthome.js'],
    host: ['Host.js'],
    hostUi: ['host/ui.js'],
    hostAudio: ['host/audio.js'],
    hostCrypto: ['host/crypto.js'],
    hostFile: ['host/file.js'],
    hostLocale: ['host/locale.js'],
    hostStorage: ['host/storage.js'],
    package: ['Package.js'],
    account: ['service/Account.js'],
    scene: ['service/scene.js'],
    spec: ['service/spec.js'],
    service: ['Service.js'],
    miotcamera: ['service/miotcamera.js'],
    ircontroller: ['service/ircontroller.js'],
    security: ['service/security.js'],
    storage: ['service/storage.js'],
    room: ['service/room.js'],
    kookong: ['service/kookong.js'],
    permission: ['service/permission.js'],
    tjinfra: ['service/tjinfra.js'],
    bluetoothDevice: ['device/bluetooth/BluetoothDevice.js'],
    bluetoothClassic: ['device/bluetooth/ClassicDevice.js'],
};

const excluded = new Set(['constructor', 'if', 'for', 'while', 'switch', 'catch']);
function methods(file) {
    const source = fs.readFileSync(file, 'utf8');
    const found = new Set();
    for (const line of source.split('\n')) {
        if (/^\s*(?:static\s+)?(?:get|set)\s+[A-Za-z_$]/.test(line)) continue;
        const match = line.match(/^\s{2,8}(?:static\s+)?(?:async\s+)?([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/);
        if (match && !excluded.has(match[1])) found.add(match[1]);
    }
    return [...found].sort();
}

const result = {};
for (const [name, files] of Object.entries(surfaces)) {
    const found = new Set();
    for (const relative of files) {
        const file = path.join(sourceRoot, relative);
        if (!fs.existsSync(file)) throw new Error(`缺少官方 SDK 文件: ${relative}`);
        for (const method of methods(file)) found.add(method);
    }
    result[name] = [...found].sort();
}

const output = `// 由 scripts/generate-mijia-sdk-api.cjs 从官方 miot-plugin-sdk 生成，请勿手改。\n` +
`export const officialApi = Object.freeze({\n${Object.entries(result).map(([name, list]) => `    ${name}: Object.freeze(${JSON.stringify(list)}),`).join('\n')}\n});\n`;
const target = path.resolve(__dirname, 'runtime/official-api.mjs');
fs.writeFileSync(target, output);
const apiRepo = fs.readFileSync(path.join(sourceRoot, 'service/apiRepo.js'), 'utf8');
const explicitRead = new Set([
    '/v2/home/device_support_split',
    '/v2/home/standard_consumable_items',
    '/home/checkversion',
    '/home/multi_checkversion',
    '/home/latest_version',
    '/v2/device/latest_ver',
    '/v2/device/get_auto_upgrade_config',
    '/v2/device/get_firmware_history',
    '/v2/device/multi_check_device_version',
    '/v2/device/auto_upgrade_list',
    '/v2/plugin/get_protocol',
    '/v2/product/get_brand_details',
    '/v2/device/range_get_extra_data',
    '/device/batchdevicedatas',
    '/v2/device/multi_button_template',
    '/v2/device/batchgetdatas',
    '/v2/device/batchGetRecord',
    '/v2/home/range_get_open_config',
    '/home/device_list',
    '/home/batchgetfileurl',
    '/device/deviceinfo',
    '/voicectrl/ai_devs',
    '/v2/irdevice/controllers',
    '/v2/irdevice/controller/keys',
    '/v2/ircode/controller/functions',
    '/v2/ircode/controller/keys',
    '/scene/idfy_get',
    '/v2/groupv2/query_status',
    '/v2/groupv2/query_tags',
    '/v2/user/get_common_config',
]);
const readSegment = /^(?:get|list|query|check|latest|status|info|profiles?|statistics|country|history|eventlist|categories|brands|areas?|provinces|cities|lineups|weekday|capacity|exist|deviceinfo|weather|keys)/;
const cloud = {};
for (const match of apiRepo.matchAll(/["'](\/[^"']+)["']\s*:/g)) {
    const api = match[1];
    const read = explicitRead.has(api) || api.split('/').some(segment => readSegment.test(segment));
    cloud[api] = read ? 'read' : 'write';
}
Object.assign(cloud, {
    '/v2/device/multi_check_device_version': 'read',
    '/v2/device/auto_upgrade_list': 'read',
    '/v2/plugin/get_protocol': 'read',
    // 当前官方共享 SDK 使用这些只读路径，开源 apiRepo 可能尚未登记。
    '/v2/home/standard_consumable_items': 'read',
    '/v2/user/get_user_device_data': 'read',
    '/v2/device/deviceinfo': 'read',
    '/v2/device/switch_subclass': 'read',
    '/v2/plugin/get_operate_configuration': 'read',
});
const cloudTarget = path.resolve(__dirname, 'runtime/official-cloud-api.json');
fs.writeFileSync(cloudTarget, `${JSON.stringify(cloud, null, 4)}\n`);
console.log(Object.entries(result).map(([name, list]) => `${name}: ${list.length}`).join('\n'));
console.log(`cloud APIs: ${Object.keys(cloud).length} (${Object.values(cloud).filter(v => v === 'read').length} read)`);
console.log(`written ${target}`);
console.log(`written ${cloudTarget}`);
