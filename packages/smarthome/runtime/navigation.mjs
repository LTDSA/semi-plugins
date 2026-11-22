// 对照官方共享 SDK react-navigation/createConfigGetter：导航器 → 页面 → 路由配置。
export function resolveNavigationOptions(route, screen, defaults, navigation, screenProps = {}) {
    let result = {};
    for (const config of [defaults, screen.navigationOptions, route === screen ? null : route.navigationOptions]) {
        const value = typeof config === 'function' ? config({ navigation, screenProps, navigationOptions: result }) : config;
        if (value && typeof value === 'object') result = { ...result, ...value };
    }
    return result;
}

export function mergeNavigationParams(stack, key, params) {
    const index = stack.findIndex(route => route.key === key);
    if (index < 0 || Object.entries(params).every(([name, value]) => Object.is(stack[index].params[name], value))) return stack;
    return stack.map((route, i) => i === index ? { ...route, params: { ...route.params, ...params } } : route);
}

export function createNavigationCompatibility(React, { View, defaultHeader, close, unsupported }) {
    const noop = () => {};
    const Context = React.createContext(null);
    const withNavigation = (Screen, focus = false) => {
        const Wrapped = props => {
            const parentNavigation = React.useContext(Context);
            const navigation = props.navigation || parentNavigation;
            return React.createElement(Screen, { ...props, navigation, ...(focus ? { isFocused: navigation?.isFocused?.() === true } : {}) });
        };
        Wrapped.navigationOptions = Screen.navigationOptions;
        return Wrapped;
    };
    const makeNavigator = (routes, options = {}, switchNavigator = false) => {
        const Component = props => {
            const serial = React.useRef(0);
            const [stack, setStack] = React.useState([{ key: 'route-0', name: options.initialRouteName || Object.keys(routes)[0], params: options.initialRouteParams || {} }]);
            const current = stack[stack.length - 1], route = routes[current.name], Screen = route.screen || route;
            const goBack = () => { if (stack.length > 1) setStack(previous => previous.slice(0, -1)); else close(); };
            const navigate = (name, params = {}) => {
                if (typeof name === 'object') { params = name.params || {}; name = name.routeName; }
                if (!routes[name]) { unsupported(); return; }
                const next = { key: `route-${++serial.current}`, name, params };
                setStack(previous => switchNavigator ? [next] : [...previous, next]);
            };
            const navigation = {
                state: { key: current.key, routeName: current.name, params: current.params }, getParam: (key, fallback) => current.params[key] ?? fallback,
                // 官方页面会在构造函数中 setParams；完成本轮挂载后再派发，避免反复中断挂载。
                setParams: params => { Promise.resolve().then(() => setStack(previous => mergeNavigationParams(previous, current.key, params))); },
                addListener: () => ({ remove: noop }), navigate, push: navigate, goBack, pop: goBack, isFocused: () => true,
                dispatch: action => { if (/BACK|POP/i.test(action.type)) goBack(); else if (/NAVIGATE|PUSH/i.test(action.type)) navigate(action.routeName, action.params); },
            };
            const config = resolveNavigationOptions(route, Screen, options.defaultNavigationOptions || options.navigationOptions, navigation, props.screenProps);
            let header = null;
            if (!switchNavigator && options.headerMode !== 'none' && config.header !== null && config.header !== false && config.headerShown !== false) {
                const headerProps = { navigation, scene: { route: navigation.state, descriptor: { options: config }, index: stack.length - 1 }, ...config };
                header = config.header === undefined ? defaultHeader(headerProps) : typeof config.header === 'function' ? config.header(headerProps) : config.header;
            }
            return React.createElement(Context.Provider, { value: navigation }, React.createElement(View, { style: { flex: 1, minHeight: 0 } },
                header == null ? null : React.createElement(View, { style: { flexShrink: 0, zIndex: 1 } }, header),
                React.createElement(View, { style: { flex: 1, minHeight: 0, overflow: 'hidden' } }, React.createElement(Screen, { ...props, navigation }))));
        };
        Component.router = { getStateForAction: () => ({ routes: [] }) };
        return Component;
    };
    return {
        withNavigation: Screen => withNavigation(Screen),
        withNavigationFocus: Screen => withNavigation(Screen, true),
        createStackNavigator: (routes, options) => makeNavigator(routes, options),
        createSwitchNavigator: (routes, options) => makeNavigator(routes, options, true),
    };
}
