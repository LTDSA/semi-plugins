import React from 'react';
import ReactDOM from 'react-dom';
import { LottieView } from './LottieView.jsx';

const views = new WeakMap();
export class NativeLottie extends React.Component {
    componentDidMount() { this.node = ReactDOM.findDOMNode(this); if (this.node) views.set(this.node, this); }
    componentWillUnmount() { if (this.node) views.delete(this.node); }
    setNativeProps(props) { this.animation?.setNativeProps(props); }
    render() {
        if (this.sourceText !== this.props.sourceJson) {
            this.sourceText = this.props.sourceJson;
            try { this.sourceValue = this.props.sourceJson ? JSON.parse(this.props.sourceJson) : this.props.source; } catch { this.sourceValue = null; }
        }
        const source = this.sourceValue || this.props.source;
        return <LottieView {...this.props} source={source} ref={animation => { this.animation = animation; }} />;
    }
}
export const lottieCommands = { play: 'play', reset: 'reset', pause: 'pause', resume: 'resume' };
export function dispatchLottie(node, command, args = []) {
    const view = views.get(node);
    if (view && Object.hasOwn(lottieCommands, command)) view.animation?.[command]?.(...args);
}
export function updateLottie(node, props) { views.get(node)?.setNativeProps(props); }
