import React from 'react';

// 适配 SDK 原生对话框的属性和 nativeEvent；设备原包中的包装组件继续执行。
export function createNativeDialog(kind) {
    return class NativeDialog extends React.Component {
        state = { dismissed: false, text: this.props.defaultText || '', check: this.props.check ?? -1 };
        componentDidMount() { this.resetTimer(); }
        componentDidUpdate(previous) {
            if (previous.visible !== this.props.visible) {
                if (this.props.visible) this.setState({ dismissed: false, text: this.props.defaultText || '', check: this.props.check ?? -1 });
                this.resetTimer();
            }
        }
        componentWillUnmount() { clearTimeout(this.timer); }
        resetTimer() {
            clearTimeout(this.timer);
            if (this.props.visible && this.props.timeout > 0) this.timer = setTimeout(() => this.dismiss(), this.props.timeout);
        }
        dismiss(action) {
            clearTimeout(this.timer);
            const nativeEvent = kind === 'input' ? { text: this.state.text } : kind === 'single' ? { check: this.state.check } : {};
            this.setState({ dismissed: true });
            if (action) this.props[action]?.({ nativeEvent });
            this.props.onDismiss?.({ nativeEvent });
        }
        render() {
            const p = this.props;
            if (!p.visible || this.state.dismissed) return null;
            const Input = p.singleLine === false ? 'textarea' : 'input';
            return <div style={{ position: 'fixed', inset: 0, zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0006' }} onClick={() => { if (p.cancelable) this.dismiss('onCancel'); }}>
                <section role="dialog" aria-modal="true" aria-label={p.title} style={{ width: '84%', maxHeight: '80%', overflow: 'auto', borderRadius: 20, padding: 24, boxSizing: 'border-box', background: 'Canvas', color: 'CanvasText' }} onClick={event => event.stopPropagation()}>
                    {p.title && <h3 style={{ margin: '0 0 16px' }}>{p.title}</h3>}
                    {p.message && <p>{p.message}</p>}
                    {kind === 'input' && <Input aria-label={p.placeholder || p.title} placeholder={p.placeholder} value={this.state.text} onChange={event => this.setState({ text: event.target.value })} style={{ width: '100%', boxSizing: 'border-box', padding: 12 }} />}
                    {kind === 'single' && (p.dataSource || []).map((text, index) => <label key={index} style={{ display: 'block', padding: '12px 0' }}><input type="radio" checked={this.state.check === index} onChange={() => { this.setState({ check: index }); p.onCheck?.({ nativeEvent: { check: index } }); }} />{text}</label>)}
                    {kind === 'loading' && <progress aria-label={p.message || p.title} style={{ width: '100%' }} />}
                    {kind === 'progress' && <progress max={p.max || 100} value={p.progress || 0} style={{ width: '100%' }} />}
                    {(p.cancel || p.confirm) && <div style={{ display: 'flex', justifyContent: 'space-around', gap: 12, marginTop: 20 }}>
                        {p.cancel && <button onClick={() => this.dismiss('onCancel')}>{p.cancel}</button>}
                        {p.confirm && <button onClick={() => this.dismiss('onConfirm')}>{p.confirm}</button>}
                    </div>}
                </section>
            </div>;
        }
    };
}

export const nativeDialogs = Object.fromEntries(Object.entries({ RCTInputDialog: 'input', RCTSingleChoseDialog: 'single', RCTMessageDialog: 'message', RCTLoadingDialog: 'loading', RCTProgressDialog: 'progress' }).map(([name, kind]) => [name, createNativeDialog(kind)]));
