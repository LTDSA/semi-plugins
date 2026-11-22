import React from 'react';
import * as Web from 'react-native-web';
import lottie from 'lottie-web/build/player/lottie_light.js';

// SVG light renderer 不包含表达式求值，沿用 opaque iframe 的无 eval 策略。
export class LottieView extends React.Component {
    componentDidMount() { this.load(); }
    componentDidUpdate(previous) {
        if (previous.source !== this.props.source) this.load();
        if (previous.speed !== this.props.speed) this.animation?.setSpeed(this.props.speed ?? 1);
        if (previous.progress !== this.props.progress && Number.isFinite(this.props.progress)) this.seek(this.props.progress);
    }
    componentWillUnmount() { this.generation = (this.generation || 0) + 1; this.controller?.abort(); this.animation?.destroy(); }
    async load() {
        const generation = this.generation = (this.generation || 0) + 1;
        this.controller?.abort();
        const controller = this.controller = new AbortController();
        this.animation?.destroy();
        const { loop = true, autoPlay = false, speed = 1, progress } = this.props;
        let source = this.props.source;
        if (source?.uri && source.uri.startsWith(window.__SEMI_MIJIA_BOOT.base + 'assets/') && source.uri.endsWith('.json')) {
            try { source = await (await fetch(source.uri, { signal: controller.signal, credentials: 'omit' })).json(); }
            catch { return; }
        }
        if (generation !== this.generation) return;
        if (!source || typeof source !== 'object' || !Array.isArray(source.layers)) return;
        // 动画只允许包内矢量数据，禁止原始 JSON 内嵌的外部图片/字体 URL。
        if (source.assets?.some(asset => asset.p && !asset.p.startsWith('data:')) || source.fonts?.list?.some(font => font.fPath)) return;
        this.animation = lottie.loadAnimation({ container: this.container, renderer: 'svg', loop, autoplay: autoPlay, animationData: JSON.parse(JSON.stringify(source)) });
        this.animation.setSpeed(speed);
        this.animation.addEventListener('complete', () => this.props.onAnimationFinish?.(false));
        if (Number.isFinite(progress) && !autoPlay) this.seek(progress);
        if (this.pendingPlay) this.play(...this.pendingPlay);
    }
    seek(progress) { this.animation?.goToAndStop(Math.max(0, Math.min(1, progress)) * this.animation.totalFrames, true); }
    play(start = -1, end = -1) {
        this.pendingPlay = [start, end];
        if (start >= 0 && end >= 0) this.animation?.playSegments([start, end], true);
        else this.animation?.play();
    }
    pause() { this.pendingPlay = null; this.animation?.pause(); }
    resume() { this.animation?.play(); }
    reset() { this.pendingPlay = null; this.animation?.goToAndStop(0, true); }
    setNativeProps({ progress }) { if (Number.isFinite(progress)) this.seek(progress); }
    render() {
        return <Web.View style={this.props.style}><div ref={node => { this.container = node; }} style={{ position: 'absolute', inset: 0 }} /></Web.View>;
    }
}
