"""Independent NumPy/SVD and finite-difference reference. No app code is imported.
Run with Python + NumPy to regenerate the committed numerical fixtures.
"""
import itertools
import json
import math
from pathlib import Path
from statistics import NormalDist
import numpy as np

ROOT = Path(__file__).resolve().parents[1]

def factor(code, mixture=False, categorical=False):
    return dict(id=code, code=code, name=code, type='Mixture' if mixture else 'Process',
                dataType='qualitative' if categorical else 'quantitative', controllability='controllable',
                unit='', low=0 if mixture else -1, high=1,
                **({'categories': ['A', 'B', 'C']} if categorical else {}))

def reference(name, points, factors, columns, order, blocks=None):
    points = np.array(points, dtype=float)
    x = np.array([columns(row) for row in points])
    blocks = np.array(blocks if blocks is not None else [1] * len(x))
    blockcols = np.array([[float(b == level) for level in sorted(set(blocks))[1:]] for b in blocks])
    treatment_p = x.shape[1]
    x = np.column_stack([x, blockcols])
    n, p = x.shape
    coefficients = np.arange(1, p + 1) / 3
    y = x @ coefficients + np.array([0.17 * math.sin(1.7 * i) + 0.11 * math.cos(0.8 * i) for i in range(n)])
    beta = np.linalg.lstsq(x, y, rcond=None)[0]
    cov = np.linalg.inv(x.T @ x)
    predicted = x @ beta
    residual = y - predicted
    sse = residual @ residual
    sst = np.sum((y - y.mean()) ** 2)
    mse = sse / (n - p)
    leverage = np.sum((x @ cov) * x, axis=1)
    # Actual delete-one fits rather than the PRESS shortcut used by the app.
    deleted = np.array([y[i] - x[i] @ np.linalg.lstsq(np.delete(x, i, 0), np.delete(y, i), rcond=None)[0] for i in range(n)])
    groups = {}
    for row, block, value in zip(points, blocks, y):
        groups.setdefault((tuple(row), int(block)), []).append(value)
    pe = sum(np.sum((np.array(values) - np.mean(values)) ** 2) for values in groups.values())
    pedf = n - len(groups)
    baseline = np.column_stack([np.ones(n), blockcols])
    residual0 = y - baseline @ np.linalg.lstsq(baseline, y, rcond=None)[0]
    ssmodel = residual0 @ residual0 - sse
    ll = -n/2 * (math.log(2 * math.pi) + 1 + math.log(sse/n))
    at = np.mean(points, axis=0)
    x0 = np.r_[columns(at), np.zeros(blockcols.shape[1])]
    return dict(name=name, points=points.tolist(), factors=factors, order=order, blocks=blocks.tolist(), y=y.tolist(),
                beta=beta.tolist(), se=np.sqrt(np.diag(cov)*mse).tolist(),
                predicted=predicted.tolist(), residual=residual.tolist(), leverage=leverage.tolist(),
                studentized=(residual/np.sqrt(mse*(1-leverage))).tolist(),
                cooks=(residual**2/mse/p*leverage/(1-leverage)**2).tolist(),
                sse=sse, sst=sst, residualDF=n-p, modelDF=treatment_p-1,
                modelF=ssmodel/(treatment_p-1)/mse,
                press=float(deleted@deleted), r2=1-sse/sst, adjusted=1-mse/(sst/(n-1)),
                predictedR2=1-float(deleted@deleted)/sst, pureError=float(pe), pureErrorDF=pedf,
                lackOfFit=float(sse-pe), lackOfFitDF=n-p-pedf,
                adequate=float(np.ptp(predicted)/math.sqrt(p*mse/n)),
                aicc=-2*ll+2*p+2*p*(p+1)/(n-p-1), bic=-2*ll+p*math.log(n), ll=ll,
                predictionPoint=at.tolist(), prediction=float(x0@beta), predictionSE=float(math.sqrt(mse*(x0@cov@x0))))

ordinary = list(itertools.product([-1, 0, 1], repeat=2))*2
mixture = [[i/4, j/4, 1-(i+j)/4] for i in range(5) for j in range(5-i)]*2
mixed = [row + [z] for row in mixture[:15] for z in [-1, 0, 1]]
categorical = list(itertools.product([-1, 0, 1], [-1, -.5, .5, 1]))*2
fixtures = [
    reference('ordinary linear', ordinary, [factor('X1'), factor('X2')], lambda r: [1, *r], 'Linear'),
    reference('ordinary quadratic', ordinary, [factor('X1'), factor('X2')], lambda r: [1, *r, r[0]*r[1], r[0]**2, r[1]**2], 'Quadratic'),
    reference('blocked quadratic', ordinary*2, [factor('X1'), factor('X2')], lambda r: [1, *r, r[0]*r[1], r[0]**2, r[1]**2], 'Quadratic', [1]*18+[2]*18),
    reference('Scheffe linear', mixture, [factor(f'X{i}', True) for i in range(1,4)], lambda r: list(r), 'Linear'),
    reference('Scheffe quadratic', mixture, [factor(f'X{i}', True) for i in range(1,4)], lambda r: [*r, r[0]*r[1], r[0]*r[2], r[1]*r[2]], 'Quadratic'),
    reference('mixture process linear', mixed, [factor(f'X{i}', True) for i in range(1,4)]+[factor('X4')], lambda r: [*r[:3], *[v*r[3] for v in r[:3]]], 'Linear'),
    reference('categorical treatment contrast', categorical, [factor('X1', categorical=True), factor('X2')], lambda r: [1, float(r[0]==0), float(r[0]==1), r[1]], 'Linear'),
]

def rng(seed):
    s = seed
    while True:
        s = (s + 0x6d2b79f5) & 0xffffffff
        t = ((s ^ (s >> 15)) * (1 | s)) & 0xffffffff
        t = ((t + (((t ^ (t >> 7)) * (61 | t)) & 0xffffffff)) & 0xffffffff) ^ t
        yield ((t ^ (t >> 14)) & 0xffffffff) / 4294967296

def neural_reference(activation, hidden2, outputs):
    random = rng(123)
    def normal(sd):
        return math.sqrt(-2*math.log(max(1e-12,next(random))))*math.cos(2*math.pi*next(random))*sd
    points = np.array([[math.sin(i*.71), math.cos(i*.43)] for i in range(40)])
    ys = np.array([[1+row[0]-.4*row[1]+.1*math.sin(i), -2+.3*row[0]+row[1]**2] for i,row in enumerate(points)])[:,:outputs]
    mean, sd = ys.mean(axis=0), ys.std(axis=0,ddof=1)
    targets = (ys-mean)/sd
    weights = dict(W1=np.array([[normal(math.sqrt(2/4)) for _ in range(2)] for _ in range(2)]), b1=np.zeros(2))
    if hidden2:
        weights.update(W2=np.array([[normal(math.sqrt(2/4)) for _ in range(2)] for _ in range(2)]), b2=np.zeros(2))
    weights.update(WOut=np.array([[normal(math.sqrt(2/(2+outputs))) for _ in range(outputs)] for _ in range(2)]), bOut=np.zeros(outputs))
    def activate(x):
        if activation == 'tanh': return np.tanh(x)
        if activation == 'sigmoid': return 1/(1+np.exp(-x))
        if activation == 'relu': return np.maximum(0,x)
        if activation == 'gaussian': return np.exp(-x*x)
        return x
    z1_initial=points @ weights['W1']+weights['b1']
    active1=z1_initial > 0
    active2=(activate(z1_initial) @ weights['W2']+weights['b2']) > 0 if hidden2 else None
    derivative_mode=False
    def forward():
        z1=points @ weights['W1']+weights['b1']
        # ReLU is nondifferentiable at zero. Verify the implemented subgradient
        # convention ReLU'(0)=0 by holding its active set during differences.
        hidden=z1*active1 if derivative_mode and activation=='relu' else activate(z1)
        if hidden2:
            z2=hidden @ weights['W2']+weights['b2']
            hidden=z2*active2 if derivative_mode and activation=='relu' else activate(z2)
        return hidden @ weights['WOut']+weights['bOut']
    def loss():
        return np.sum((forward()-targets)**2)/(2*len(points))+.03/2*sum(np.sum(v*v) for k,v in weights.items() if k.startswith('W'))
    grads = {}
    derivative_mode=True
    for key,array in weights.items():
        grads[key]=np.zeros_like(array)
        for idx in np.ndindex(array.shape):
            original=array[idx]; h=1e-5
            array[idx]=original+h; plus=loss()
            array[idx]=original-h; minus=loss()
            array[idx]=original
            grads[key][idx]=(plus-minus)/(2*h)
    derivative_mode=False
    for key in weights:
        weights[key] -= .01*grads[key]/(np.abs(grads[key])+1e-8)
    predicted = forward()*sd+mean
    return dict(activation=activation, hidden2=hidden2, outputs=outputs, points=points.tolist(), y=ys.tolist(),
                expected={k:v.tolist() for k,v in weights.items()}, predicted=predicted.tolist(), loss=float(loss()))

neural=[neural_reference(a,h,m) for a in ['linear','tanh','sigmoid','relu','gaussian'] for h in [0,2] for m in [1,2]]
result=dict(numpyVersion=np.__version__, ols=fixtures, neural=neural,
            normal=[dict(p=p,x=NormalDist().inv_cdf(p)) for p in [.000001,.001,.025,.1,.5,.9,.975,.999,.999999]])
destination=ROOT/'src/services/fixtures/statistical-reference.json'
destination.parent.mkdir(parents=True,exist_ok=True)
destination.write_text(json.dumps(result,ensure_ascii=False,indent=2,allow_nan=False),encoding='utf-8')
print(f'NumPy {np.__version__}: {len(fixtures)} OLS and {len(neural)} finite-difference ANN references -> {destination}')
