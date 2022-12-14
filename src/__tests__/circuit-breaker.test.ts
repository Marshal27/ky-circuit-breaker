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
        jest.clearAllMocks();
      });

    describe('protecting a promise', () => {
        it('should protect all default ky functions', () => {
            expect(protectPromiseSpy).toHaveBeenCalledTimes(6);
        });
        it('should assign ky hooks to options and callSucceed', async () => {
            await mockKyInstance.get({}, {});

            expect(mockOptions.hooks.beforeRetry.length).toBeTruthy();
            expect(mockOptions.hooks.beforeRequest.length).toBeTruthy();
            expect(mockOptions.hooks.afterResponse.length).toBeTruthy();
            expect(callSucceedSpy).toBeCalledTimes(1);
        });
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
            it('should not call preCall', () => {    
                mockOptions.hooks.beforeRequest[0]();
    
                expect(preCallSpy).toBeCalledTimes(0);
            });
            it('should preCall and set noOpCallSucceed to true when !this.stateMachine.currentState.isCallPermitted()', () => {
                circuitBreaker['stateMachine'] = {
                    currentState: {
                        isCallPermitted: () => false
                    }
                } as any;
                expect(circuitBreaker['noOpCallSucceed']).toBeFalsy();
                
                mockOptions.hooks.beforeRequest[0]();
                
                expect(circuitBreaker['noOpCallSucceed']).toBeTruthy();
                expect(preCallSpy).toBeCalledTimes(1);
            });
            it('should preCall and return new response if !this.stateMachine.currentState.isCallPermitted() and config.openCircuitNoOp', async () => {
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
                expect(preCallSpy).toBeCalledTimes(1);
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

            await mockKyInstance.get({}, {}).catch(() => {});

            expect(callFailedSpy).toBeCalledTimes(1);
        });
    });
});