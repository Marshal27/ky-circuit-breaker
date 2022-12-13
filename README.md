# ky-circuit-breaker
The premise here is that I wanted to have a circuit breaker pattern that could leverage the native API of a `KyInstance`. There are other options available for adopting a circuit breaker pattern, however, my goal was simplicity in the sense that I wanted to pass my `KyInstance` via the constructor and the library do the rest.

State machine logic was adopted from `albertllousas` work over @ https://github.com/albertllousas/circuit-breaker-typescript and the kudos go to him for the state machine.

## Getting Started

### Why to use it

If this resilience pattern does not sounds familiar to you, take a look on these resources:
- [Circuit breaker wikipedia](https://en.wikipedia.org/wiki/Circuit_breaker_design_pattern)
- [Circuit breaker - Martin Fowler](https://martinfowler.com/bliki/CircuitBreaker.html)
- [Release It!](https://pragprog.com/book/mnee2/release-it-second-edition)

### Install

```bash
npm i ky-circuit-breaker
```

### How to Use It

```js
import ky from 'ky';
import { CircuitBreaker } from 'ky-circuit-breaker';

const circuitBreaker = new CircuitBreaker(ky);
// that's it, your native KyInstance functions 
// are now protected with a CircuitBreaker.

const result = await ky.get('https://httpbin.org/get').json();
// make calls the normal way.
```

#### Promises
Let's assume you have an http call and you want to fail-fast gracefully without waiting for TCP connection timeout in
 case of the service eventually is not available:
```js

const unprotectedPromise = () => fetch(someUrl).then(response => response.json());
```

Protecting it is pretty straight forward:
```js

const circuitBreaker = new CircuitBreaker();

const protectedPromise = circuitBreaker.protectPromise(unprotectedPromise);

//normal use
protectedPromise().then(...);
```

### Exports

### CircuitStatusFlag

Enum for circuitStatus

shape: 

```js

export enum CircuitStatusFlag {
    CLOSED,
    HALF,
    OPEN
}
```

usage:
```js

import { CircuitBreaker, CircuitStatusFlag } from 'ky-circuit-breaker';

if (this.circuitBreaker.circuitStatus === CircuitStatusFlag.OPEN) {
    // do something interesting...
}
```

### Custom params

#### CircuitBreaker(config: CircuitBreakerConfig)

Create a new instance of a circuit breaker. It accepts the following config options:

##### CircuitBreakerConfig: maxFailures

Number of errors after the circuit trips to open and starts short-circuiting requests and failing-fast.

*Default Value:* 5

##### CircuitBreakerConfig: resetTimeoutInMillis

Time in milliseconds in which after tripping to open the circuit will remain failing fast.

*Default Value:* 1000

##### CircuitBreakerConfig: openCircuitNoOp

Boolean value to NoOp the return of rejected promise when in a fail fast state.

*Default Value:* false 

##### CircuitBreakerConfig: noOpReturn

Return string value for NoOp when in a fail fast state.

*Default Value:* '[{ "error" : "CircuitBreaker open circuit" }]' 

```typescript

const circuitBreaker = new CircuitBreaker({maxFailures: 10, resetTimeoutInMillis: 10000});
````
