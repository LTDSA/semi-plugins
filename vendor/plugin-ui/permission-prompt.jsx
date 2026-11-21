import { useState } from 'react';
import Button from '@douyinfe/semi-ui/lib/es/button';
import List from '@douyinfe/semi-ui/lib/es/list';
import Switch from '@douyinfe/semi-ui/lib/es/switch';
import Modal from '@douyinfe/semi-ui/lib/es/modal';
import IconShield from '@douyinfe/semi-icons/lib/es/icons/IconShield';

export default function PermissionPrompt({ request, onAnswer, onDismiss }) {
    const [selection, setSelection] = useState({ id: null, values: {} });
    const multiple = request?.permissions.length > 1;
    const decisions = Object.fromEntries((request?.permissions || []).map(p => [p.permission, (selection.id === request.id ? selection.values[p.permission] : undefined) !== false]));
    const allowedCount = Object.values(decisions).filter(Boolean).length;
    return <Modal visible={Boolean(request)} title={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><IconShield />权限管理</span>}
        onCancel={onDismiss} maskClosable={false}
        footer={<div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button type="tertiary" onClick={() => onAnswer(false)}>{multiple ? '全部拒绝' : '拒绝'}</Button>
            <Button theme="solid" disabled={multiple && allowedCount === 0} onClick={() => onAnswer(multiple ? decisions : true)}>
                {multiple ? allowedCount === request.permissions.length ? '全部允许' : '部分允许' : '允许'}
            </Button>
        </div>}>
        <div>{request?.name} 请求使用{multiple ? '多个权限' : <>{' '}<span style={request?.permissions[0]?.permission === 'runtime.node' ? { color: 'var(--semi-color-danger)' } : undefined}>{request?.label}</span></>}</div>
        {multiple ? <List bordered className="semi-plugin-permission-list" style={{ marginTop: 12 }} dataSource={request.permissions} renderItem={item => <List.Item key={item.permission} align="center"
            main={<div>
                <div style={item.permission === 'runtime.node' ? { color: 'var(--semi-color-danger)' } : undefined}>{item.label}</div>
                {item.reason && <div className="semi-plugin-permission-description">{item.reason}</div>}
            </div>}
            extra={<Switch checked={decisions[item.permission]} onChange={checked => setSelection(old => ({ id: request.id, values: { ...(old.id === request.id ? old.values : {}), [item.permission]: checked } }))} />}
        />} /> : request?.reason && <div style={{ marginTop: 12, color: 'var(--semi-color-text-2)' }}>{request.reason}</div>}
    </Modal>;
}
