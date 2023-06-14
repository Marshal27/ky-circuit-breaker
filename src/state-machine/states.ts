const nowSupplier = () => new Date();

interface CircuitBreakerState {
    isCallPermitted(): boolean;
    recoveryAttempts?: number;
    recoverySuccessful?: boolean;
    recoveryFailed?: boolean;
}

class ClosedCircuit implements CircuitBreakerState {
    constructor(readonly failCount: number = 0, readonly recoveryAttempts = 0, readonly recoverySuccessful = false) {
    }

    public static start = (recoveryAttempts: number) => new ClosedCircuit(0, recoveryAttempts);
    public reset = () => {
        const _recoveryAttempts = this.recoveryAttempts > 0 ? this.recoveryAttempts - 1 : this.recoveryAttempts;
        return new ClosedCircuit(
            0,
            _recoveryAttempts,
            (this.recoveryAttempts > 0 && _recoveryAttempts === 0) ? true : false
        );
    };
    public increaseFails = () => new ClosedCircuit(this.failCount + 1);
    public trip = (now = nowSupplier()) => new OpenCircuit(now, 0);
    public isCallPermitted = () => true;
}

class OpenCircuit implements CircuitBreakerState {
    public recoveryFailed: boolean;
    constructor(readonly openedAt: Date, readonly recoveryAttempts = 0, readonly _recoveryFailed = false) {
        this.recoveryFailed = _recoveryFailed;
    }
    public tryReset = () => new HalfOpenCircuit(this.recoveryAttempts + 1);
    public recoveryFailedNotified = () => this.recoveryFailed = false;
    public isCallPermitted = () => false;
}

class HalfOpenCircuit implements CircuitBreakerState {
    constructor(readonly recoveryAttempts = 0) {
    }
    public trip = (now = nowSupplier()) => new OpenCircuit(now, this.recoveryAttempts, true);
    public reset = () => ClosedCircuit.start(this.recoveryAttempts);
    public isCallPermitted = () => true;
}

export {CircuitBreakerState, ClosedCircuit, OpenCircuit, HalfOpenCircuit};
