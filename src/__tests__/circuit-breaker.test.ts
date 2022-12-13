import 'isomorphic-fetch';
import { CircuitBreaker, CircuitStatusFlag } from '../circuit-breaker';
import { ClosedCircuit, HalfOpenCircuit, OpenCircuit } from '../state-machine/states';

describe('Circuit breaker', () => {
    const wait = (millis: number) => new Promise(resolve => setTimeout(resolve, millis));
    let mockOptions: any = {};
    let resolvePromise = true;
    const mockKyInstance: any = {
        get: function(input: any, options: any) {
            mockOptions = options;
            return resolvePromise ? Promise.resolve() : Promise.reject('I AM NOW DEFINED')
        },
    };
    const mockCircuitBreaker = {
        mockPreCall: () => {},
        mockCallSucceed: () => {},
        mockCallFailed: () => {}
    }
    const mockCircuitBreakerConfig = {
        maxFailures: 1, 
        resetTimeoutInMillis: 10, 
        openCircuitNoOp: true, 
        noOpReturn: '[{ "error" : "CircuitBreaker open circuit" }]'
    }

    let circuitBreaker: CircuitBreaker;
    let protectPromiseSpy: any;
    let preCallSpy: any;
    let callSucceedSpy: any;
    let callFailedSpy: any;

    protectPromiseSpy = jest.spyOn(CircuitBreaker.prototype, 'protectPromise');
    circuitBreaker = new CircuitBreaker(mockKyInstance as any, mockCircuitBreakerConfig);
    
    preCallSpy = jest.spyOn(mockCircuitBreaker, 'mockPreCall');
    callSucceedSpy = jest.spyOn(mockCircuitBreaker, 'mockCallSucceed');
    callFailedSpy = jest.spyOn(mockCircuitBreaker, 'mockCallFailed');

    circuitBreaker['preCall'] = mockCircuitBreaker.mockPreCall;
    circuitBreaker['callSucceed'] = mockCircuitBreaker.mockCallSucceed;
    circuitBreaker['callFailed'] = mockCircuitBreaker.mockCallFailed;

    afterEach(() => {
        // restore the spy created with spyOn
        jest.restoreAllMocks();
      });

    describe('protecting a promise', () => {
        it('should protect all default ky functions', () => {
            expect(protectPromiseSpy).toHaveBeenCalledTimes(6);
        });
        it('should assign ky hooks to options', async () => {
            await mockKyInstance.get({}, {});

            expect(mockOptions.hooks.beforeRetry.length).toBeTruthy();
            expect(mockOptions.hooks.beforeRequest.length).toBeTruthy();
            expect(mockOptions.hooks.afterResponse.length).toBeTruthy();
        });
        it('should callSucceed if !noOpCallSucceed and Promise.resolve', async () => {
            // call from line 55
            expect(callSucceedSpy).toBeCalledTimes(1);
        })
        it('should set noOpCallSucceed to false if true on Promise.resolve', async () => {
            circuitBreaker['noOpCallSucceed'] = true;

            await mockKyInstance.get({}, {});

            expect(circuitBreaker['noOpCallSucceed']).toBeFalsy();
        });
        describe('beforeRetry', () => {
            it('should NOT callFailed when retry.retryCount === 1', () => {
                mockOptions.hooks.beforeRetry[0]({ retryCount: 1});

                expect(callFailedSpy).toBeCalledTimes(0);
            });
            it('should callFailed when retry.retryCount > 1', () => {
                mockOptions.hooks.beforeRetry[0]({ retryCount: 2});

                expect(callFailedSpy).toBeCalledTimes(1);
            });
        });
        describe('beforeRequest', () => {
            it('should preCall', () => {    
                mockOptions.hooks.beforeRequest[0]();
    
                expect(preCallSpy).toBeCalledTimes(1);
            });
            it('should set noOpCallSucceed to true when !this.stateMachine.currentState.isCallPermitted()', () => {
                circuitBreaker['stateMachine'] = {
                    currentState: {
                        isCallPermitted: () => false
                    }
                } as any;
                expect(circuitBreaker['noOpCallSucceed']).toBeFalsy();
    
                mockOptions.hooks.beforeRequest[0]();
    
                expect(circuitBreaker['noOpCallSucceed']).toBeTruthy();
            });
            it('should return new response if !this.stateMachine.currentState.isCallPermitted() and config.openCircuitNoOp', async () => {
                circuitBreaker['stateMachine'] = {
                    currentState: {
                        isCallPermitted: () => false
                    }
                } as any;
                const originalResponse = {
                    original: 'I AM ORIGINAL'
                }

                const result = await mockOptions.hooks.beforeRequest[0](originalResponse).text();

                expect(result).not.toEqual(originalResponse);
                expect(result).toEqual(mockCircuitBreakerConfig.noOpReturn);
            });
            it('should return original response if !this.stateMachine.currentState.isCallPermitted() and !config.openCircuitNoOp', () => {
                mockCircuitBreakerConfig.openCircuitNoOp = false;
                circuitBreaker['stateMachine'] = {
                    currentState: {
                        isCallPermitted: () => false
                    }
                } as any;
                const originalResponse = {
                    original: 'I AM ORIGINAL'
                }

                const result = mockOptions.hooks.beforeRequest[0](originalResponse);

                expect(result).toEqual(originalResponse);
            });
        });
        describe('afterResponse', () => {
            it('should set circuitStatus to CircuitStatusFlag.OPEN if stateMachine.currentState instanceof OpenCircuit', () => {
                circuitBreaker['stateMachine'] = {
                    currentState: new OpenCircuit(new Date())
                } as any;
                expect(circuitBreaker.circuitStatus).toEqual(CircuitStatusFlag.CLOSED);

                mockOptions.hooks.afterResponse[0]();

                expect(circuitBreaker.circuitStatus).toEqual(CircuitStatusFlag.OPEN);
            });
            it('should set circuitStatus to CircuitStatusFlag.HALF if stateMachine.currentState instanceof HalfOpenCircuit', () => {
                circuitBreaker['stateMachine'] = {
                    currentState: new HalfOpenCircuit()
                } as any;
                expect(circuitBreaker.circuitStatus).toEqual(CircuitStatusFlag.OPEN);

                mockOptions.hooks.afterResponse[0]();

                expect(circuitBreaker.circuitStatus).toEqual(CircuitStatusFlag.HALF);
            });
            it('should set circuitStatus to CircuitStatusFlag.CLOSED if stateMachine.currentState instanceof ClosedCircuit', () => {
                circuitBreaker['stateMachine'] = {
                    currentState: new ClosedCircuit()
                } as any;
                expect(circuitBreaker.circuitStatus).toEqual(CircuitStatusFlag.HALF);

                mockOptions.hooks.afterResponse[0]();
                
                expect(circuitBreaker.circuitStatus).toEqual(CircuitStatusFlag.CLOSED);
            });
        });
        it('should callFailed when Promise.reject', async () => {
            resolvePromise = false;

            mockKyInstance.get({}, {}).catch(() => {
                expect(callFailedSpy).toBeCalledTimes(1);
            });
        });
        // it('should not fail fast when calls succeed', async () => {
        //     const nonFailingPromise = Promise.resolve('ok');
        //     const protectedPromise = circuitBreaker.protectPromise(() => nonFailingPromise as any);

        //     await expect(protectedPromise({} as any, {} as any)).resolves.toBe('ok');
        //     await expect(protectedPromise({} as any, {} as any)).resolves.toBe('ok');
        // });

        // it('should fail fast when max failures are reached', async () => {
        //     circuitBreaker = new CircuitBreaker({} as any, {maxFailures: 1, resetTimeoutInMillis: 10000});
        //     const failingPromise = Promise.reject('ko');
        //     const protectedPromise = circuitBreaker.protectPromise(() => failingPromise as any);

        //     await expect(protectedPromise({} as any, {} as any)).rejects.toBe('ko');
        //     await expect(protectedPromise({} as any, {} as any)).rejects.toBe('ko');
        //     await expect(protectedPromise({} as any, {} as any)).rejects.toBe('ko');
        //     await expect(protectedPromise({} as any, {} as any)).rejects.toBe('ko');
        //     await expect(protectedPromise({} as any, {} as any)).rejects.toBe('ko');
        //     await expect(protectedPromise({} as any, {} as any)).rejects.toEqual(new Error('CircuitBreaker: fail-fast'));

        // });

        // it('should let the calls go through when timeout is reached after failing fast', async () => {
        //     circuitBreaker = new CircuitBreaker({} as any, {maxFailures: 1, resetTimeoutInMillis: 100});
        //     const failingPromise = Promise.reject('ko');
        //     const protectedPromise = circuitBreaker.protectPromise(() => failingPromise as any);

        //     await expect(protectedPromise({} as any, {} as any)).rejects.toBe('ko');
        //     await expect(protectedPromise({} as any, {} as any)).rejects.toEqual(new Error('CircuitBreaker: fail-fast'));
        //     await wait(200);
        //     await expect(protectedPromise({} as any, {} as any)).rejects.toBe('ko');
        // });
    });
});