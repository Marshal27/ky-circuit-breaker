import { CircuitBreakerStateMachine } from './state-machine/state-machine';
import { ClosedCircuit, OpenCircuit, HalfOpenCircuit } from './state-machine/states';
import { KyInstance } from 'ky/distribution/types/ky';
import { Input } from 'ky/distribution/types/options';
import { Options, ResponsePromise } from 'ky';

export interface CircuitBreakerConfig {
    maxFailures: number;
    timeoutLimit: number;
    hooks?: {
        beforeRequest?: (() => void)[],
        afterPromiseComplete?: ((recoveryAttempts: number, recoverySuccessful: boolean, recoveryFailed: boolean) => void)[]
    };
}

export enum CircuitStatusFlag {
    CLOSED,
    HALF,
    OPEN
}

enum TransitionFlag {
    PRE = 'BeforeCallSignal',
    SUCCESS = 'CallSucceed',
    FAILURE = 'CallFailed'
}
export class CircuitBreaker {
    public circuitStatus: CircuitStatusFlag = CircuitStatusFlag.CLOSED;
    private stateMachine: CircuitBreakerStateMachine;

    constructor(
        ky: KyInstance,
        readonly config: CircuitBreakerConfig = {
            maxFailures: 5,
            timeoutLimit: 5000
        },
        readonly now: () => Date = () => new Date()
    ) {
        this.stateMachine = this.initStateMachine(config, now);
        ky.get = this.protectPromise(ky.get);
        ky.post = this.protectPromise(ky.post);
        ky.put = this.protectPromise(ky.put);
        ky.patch = this.protectPromise(ky.patch);
        ky.head = this.protectPromise(ky.head);
        ky.delete = this.protectPromise(ky.delete);
    }

    public protectPromise(lazyPromise: (input: Input, options?: Options) => ResponsePromise): (input: Input, options?: Options) => ResponsePromise {
        const protectedPromise = (input: Input, options?: Options) => {
            const abortController = new AbortController();
            const { signal } = abortController;
            options = {
                signal,
                ...(options ? options : {}),
                hooks: {
                    beforeRetry: [
                        ...(options?.hooks?.beforeRetry ? options.hooks.beforeRetry : []),
                        () => {
                            this.handleStateTransition(TransitionFlag.FAILURE);
                        }],
                    beforeRequest: [
                        ...(options?.hooks?.beforeRequest ? options.hooks.beforeRequest : []),
                        () => {
                            this.handleStateTransition(TransitionFlag.PRE);
                            if (!this.stateMachine.currentState.isCallPermitted()) {
                                abortController.abort();
                            }
                        }],
                }
            };

            const result = lazyPromise(input, options);
            result
                .then(() => this.handleStateTransition(TransitionFlag.SUCCESS))
                .catch(() => this.handleStateTransition(TransitionFlag.FAILURE));
            return result;
        };
        return protectedPromise;
    }

    private initStateMachine(config: CircuitBreakerConfig, now: () => Date) {
        const isThresholdReached: (fails: number) => boolean = fails => fails >= config.maxFailures;
        const isTimeoutReached: (open: OpenCircuit) => boolean =
            open => (open.openedAt.getTime() + config.timeoutLimit) < now().getTime();
        return new CircuitBreakerStateMachine(new ClosedCircuit(), isThresholdReached, isTimeoutReached);
    }

    private handleStateTransition = (flag: TransitionFlag) => {
        this.stateMachine = this.stateMachine.transition(flag);
        switch(flag) {
            case TransitionFlag.PRE: {
                this.setCircuitStatusFlag();
                this.invokeAllBeforeRequestHooks();
                break;
            }
            default: {
                this.setCircuitStatusFlag();
                this.invokeAllAfterPromiseCompleteHooks();
                break;
            }
        }
    }

    private setCircuitStatusFlag = () => {
        switch (true) {
            case this.stateMachine.currentState instanceof OpenCircuit:
                this.circuitStatus = CircuitStatusFlag.OPEN;
                break;
            case this.stateMachine.currentState instanceof HalfOpenCircuit:
                this.circuitStatus = CircuitStatusFlag.HALF;
                break;
            case this.stateMachine.currentState instanceof ClosedCircuit:
                this.circuitStatus = CircuitStatusFlag.CLOSED;
                break;
        }
    }

    private invokeAllBeforeRequestHooks = () => {
        const funcArray = this.config?.hooks?.beforeRequest;
        if (funcArray?.length) {
            for (const func of funcArray) {
                func();
            }
        }
    }

    private invokeAllAfterPromiseCompleteHooks = () => {
        const recoverySuccessful = this.stateMachine.currentState.recoverySuccessful ?? false;
        const recoveryAttempts = this.stateMachine.currentState.recoveryAttempts ?? 0;
        const recoveryFailed = this.stateMachine.currentState.recoveryFailed ?? false;
        const funcArray = this.config?.hooks?.afterPromiseComplete;
        if (funcArray?.length) {
            for (const func of funcArray) {
                func(recoveryAttempts, recoverySuccessful, recoveryFailed);
            }
        }
        if (this.stateMachine.currentState instanceof OpenCircuit && this.stateMachine.currentState.recoveryFailed) {
            this.stateMachine.currentState.recoveryFailedNotified();
        }
    }
}