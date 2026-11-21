const fs = require('fs');
const path = require('path');
const root = path.resolve(path.dirname(require.resolve('@douyinfe/semi-ui')), '../..');
fs.copyFileSync(path.join(root, 'dist/css/semi.css'), path.join(__dirname, 'semi.css'));
