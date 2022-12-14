import { CircuitBreakerStateMachine } from './state-machine/state-machine';
import { ClosedCircuit, OpenCircuit, HalfOpenCircuit } from './state-machine/states';
import { KyInstance } from 'ky/distribution/types/ky';
import { Input } from 'ky/distribution/types/options';
import { Options, ResponsePromise } from 'ky';

interface CircuitBreakerConfig {
    maxFailures: number;
    resetTimeoutInMillis: number;
    openCircuitNoOp?: boolean;
    noOpReturn?: string;
}

export enum CircuitStatusFlag {
    CLOSED,
    HALF,
    OPEN
}

export class CircuitBreaker {
    public circuitStatus: CircuitStatusFlag = CircuitStatusFlag.CLOSED;
    private stateMachine: CircuitBreakerStateMachine;
    private noOpCallSucceed: boolean = false;

    constructor(
        ky: KyInstance,
        readonly config: CircuitBreakerConfig = {
            maxFailures: 5,
            resetTimeoutInMillis: 10000,
            openCircuitNoOp: false,
            noOpReturn: '[{ "error" : "CircuitBreaker open circuit" }]'
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
        return (input, options) => {
            options = {
                ...(options ? options : {}),
                hooks: {
                    beforeRetry: [
                        ...(options?.hooks?.beforeRetry ? options.hooks.beforeRetry : []),
                        retry => {
                            if (retry.retryCount > 1) {
                                this.callFailed();
                            }
                        }],
                    beforeRequest: [
                        ...(options?.hooks?.beforeRequest ? options.hooks.beforeRequest : []),
                        request => {
                            if (!this.stateMachine.currentState.isCallPermitted()) {
                                this.noOpCallSucceed = true;
                                if (this.config.openCircuitNoOp) {
                                    this.preCall();
                                    return new Response(this.config.noOpReturn, { status: 200 });
                                } else {
                                    this.preCall();
                                    return request;
                                }
                            }
                        }],
                    afterResponse: [
                        () => {
                            switch(true) {
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
                    ]
                }
            };

            const result = lazyPromise(input, options);
            result
                .then(() => {
                    if (this.noOpCallSucceed) {
                        /* NOOP - nom nom */
                        this.noOpCallSucceed = false;
                    } else {
                        this.callSucceed();
                    }
                })
                .catch(() => this.callFailed());
            return result;
        };
    }

    private initStateMachine(config: CircuitBreakerConfig, now: () => Date) {
        const isThresholdReached: (fails: number) => boolean = fails => fails >= config.maxFailures;
        const isTimeoutReached: (open: OpenCircuit) => boolean =
            open => (open.openedAt.getTime() + config.resetTimeoutInMillis) < now().getTime();
        return new CircuitBreakerStateMachine(new ClosedCircuit(), isThresholdReached, isTimeoutReached);
    }

    private preCall = () => { this.stateMachine = this.stateMachine.transition('BeforeCallSignal'); };

    private callSucceed = () => { this.stateMachine = this.stateMachine.transition('CallSucceed'); };

    private callFailed = () => { this.stateMachine = this.stateMachine.transition('CallFailed'); };
}