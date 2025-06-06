// --- CONFIGURAÇÕES --- 
const CONFIG = {
    maxHistorySize: 10000,          // Tamanho máximo do histórico (aumentado para análise profunda)
    learningRateUp: 0.10,           // Taxa de aprendizado para cima (aumentada para 10%)
    learningRateDown: 0.08,         // Taxa de aprendizado para baixo (aumentada para 8%)
    updateInterval: 120,            // Intervalo de atualização automática em segundos
    patternThreshold: 0.6,          // Limiar para detecção de padrões
    anomalyThreshold: 0.75,         // Limiar para detecção de anomalias
    apiUrl: '/api/results',         // URL da API para buscar resultados
    analyzeUrl: '/api/analyze',     // URL da API para análise
    maxConfidence: 85,              // Confiança máxima permitida (nunca 100%)
    temporalWeight: 0.3,            // Peso para análise temporal
    recentWeight: 0.5,              // Peso para resultados recentes
    patternWeight: 0.2              // Peso para padrões identificados
};

// --- ESTADO DA APLICAÇÃO ---
const STATE = {
    results: [],                   // Histórico de resultados
    predictions: [],               // Previsões atuais
    allProbabilities: {},          // Probabilidades de todos os resultados
    pattern: "Desconhecido",       // Padrão atual
    autoUpdateTimer: null,         // Timer para atualização automática
    lastUpdate: null,              // Timestamp da última atualização
    stats: {},                     // Estatísticas
    learning: {                    // Dados de aprendizado
        correct: 0,
        wrong: 0,
        lastPrediction: null,
        firstHitRate: 0            // Taxa de acerto do primeiro resultado
    },
    biases: {                      // Vieses de probabilidade (aprendizado)
        "1": 1.0,
        "2": 1.0,
        "5": 1.0,
        "10": 1.0,
        "C": 1.0,
        "P": 1.0,
        "H": 1.0,
        "CT": 1.0
    },
    temporalPatterns: {            // Padrões temporais
        hourly: {},
        daily: {}
    },
    anomalies: {                   // Detecção de anomalias
        count: 0,
        lastDetected: null,
        level: "Baixo"
    },
    previousProbabilities: {}      // Armazena probabilidades anteriores para mostrar tendências
};

// --- INICIALIZAÇÃO ---
document.addEventListener('DOMContentLoaded', () => {
    loadFromLocalStorage();
    updateUI();
    updateCurrentTimeAndDay();
    
    // Tentar carregar dados da API ao iniciar
    updateFromAPI();
    
    // Atualizar hora e dia a cada minuto
    setInterval(updateCurrentTimeAndDay, 60000);
    
    // Configurar toggle de atualização automática
    const autoUpdateToggle = document.getElementById('auto-update-toggle');
    if (autoUpdateToggle) {
        autoUpdateToggle.addEventListener('change', toggleAutoUpdate);
        
        // Iniciar atualização automática se estiver ativada
        if (autoUpdateToggle.checked) {
            startAutoUpdate();
        }
    }
});

// --- FUNÇÕES DE MANIPULAÇÃO DE DADOS ---

// Adicionar resultado via seletor
function addResult() {
    const select = document.getElementById('result-select');
    const result = select.value;
    
    if (result) {
        addResultToState(result);
    }
}

// Adicionar resultado diretamente clicando na bola
function addResultDirect(result) {
    addResultToState(result);
}

// Adicionar resultado ao estado e atualizar
function addResultToState(result) {
    // Armazenar probabilidades anteriores para comparação
    STATE.previousProbabilities = {...STATE.allProbabilities};
    
    // Verificar se há uma previsão anterior para avaliar
    evaluatePreviousPrediction(result);
    
    // Adicionar novo resultado
    STATE.results.unshift(result);
    
    // Limitar tamanho do histórico
    if (STATE.results.length > CONFIG.maxHistorySize) {
        STATE.results = STATE.results.slice(0, CONFIG.maxHistorySize);
    }
    
    // Detectar possíveis anomalias
    detectAnomalies();
    
    // Analisar e gerar novas previsões
    analyzeAndPredict();
    
    // Salvar e atualizar UI
    saveToLocalStorage();
    updateUI();
}

// Avaliar previsão anterior com o resultado atual
function evaluatePreviousPrediction(actualResult) {
    if (STATE.learning.lastPrediction) {
        if (STATE.learning.lastPrediction[0] === actualResult) {
            // Acerto do primeiro resultado (mais importante)
            STATE.learning.correct++;
            
            // Ajustar viés para baixo (menos agressivo quando acerta)
            STATE.biases[actualResult] *= (1 - CONFIG.learningRateDown);
        } else {
            // Previsão errada
            STATE.learning.wrong++;
            
            // Ajustar viés para cima (mais agressivo quando erra)
            STATE.biases[actualResult] *= (1 + CONFIG.learningRateUp);
        }
        
        // Calcular taxa de acerto do primeiro resultado
        const total = STATE.learning.correct + STATE.learning.wrong;
        if (total > 0) {
            STATE.learning.firstHitRate = (STATE.learning.correct / total) * 100;
        }
        
        // Normalizar vieses para evitar valores extremos
        normalizeAllBiases();
    }
}

// Normalizar todos os vieses para manter equilíbrio
function normalizeAllBiases() {
    const sum = Object.values(STATE.biases).reduce((a, b) => a + b, 0);
    const factor = Object.keys(STATE.biases).length / sum;
    
    for (const key in STATE.biases) {
        STATE.biases[key] *= factor;
    }
}

// Detectar anomalias no comportamento do jogo
function detectAnomalies() {
    if (STATE.results.length < 20) return; // Precisa de histórico suficiente
    
    // Analisar últimas 20 rodadas vs 20 anteriores
    const recent = STATE.results.slice(0, 20);
    const previous = STATE.results.slice(20, 40);
    
    if (previous.length < 20) return;
    
    // Calcular distribuição de cada período
    const recentDist = calculateDistribution(recent);
    const prevDist = calculateDistribution(previous);
    
    // Calcular diferença entre distribuições
    let totalDiff = 0;
    for (const key in recentDist) {
        const diff = Math.abs((recentDist[key] || 0) - (prevDist[key] || 0));
        totalDiff += diff;
    }
    
    // Se a diferença for maior que o limiar, registrar anomalia
    if (totalDiff > CONFIG.anomalyThreshold) {
        STATE.anomalies.count++;
        STATE.anomalies.lastDetected = new Date().toLocaleTimeString();
        
        // Ajustar nível de alerta
        if (STATE.anomalies.count > 5) {
            STATE.anomalies.level = "Alto";
        } else if (STATE.anomalies.count > 2) {
            STATE.anomalies.level = "Médio";
        }
        
        // Reiniciar parcialmente o aprendizado
        partialResetLearning();
    }
}

// Reiniciar parcialmente o aprendizado após detecção de anomalia
function partialResetLearning() {
    // Reduzir o impacto dos vieses atuais (sem zerar completamente)
    for (const key in STATE.biases) {
        // Aproximar do valor neutro (1.0)
        STATE.biases[key] = STATE.biases[key] * 0.5 + 0.5;
    }
}

// Calcular distribuição de resultados em um array
function calculateDistribution(results) {
    const dist = {};
    const total = results.length;
    
    results.forEach(result => {
        dist[result] = (dist[result] || 0) + 1;
    });
    
    // Converter para porcentagens
    for (const key in dist) {
        dist[key] = dist[key] / total;
    }
    
    return dist;
}

// Analisar dados e gerar previsões
function analyzeAndPredict() {
    if (STATE.results.length === 0) return;
    
    // Calcular estatísticas
    calculateStats();
    
    // Determinar padrão atual
    determinePattern();
    
    // Gerar previsões baseadas no padrão e vieses
    generatePredictions();
    
    // Atualizar padrões temporais
    updateTemporalPatterns();
}

// Calcular estatísticas dos resultados
function calculateStats() {
    const stats = {
        "1": 0, "2": 0, "5": 0, "10": 0,
        "C": 0, "P": 0, "H": 0, "CT": 0
    };
    
    STATE.results.forEach(result => {
        if (stats[result] !== undefined) {
            stats[result]++;
        }
    });
    
    STATE.stats = stats;
}

// Determinar padrão atual com base nos resultados recentes
function determinePattern() {
    // Usar últimas 20 rodadas para determinar padrão
    const recent = STATE.results.slice(0, Math.min(20, STATE.results.length));
    
    // Contar especiais (não números)
    const specialCount = recent.filter(r => !["1", "2", "5", "10"].includes(r)).length;
    const specialRatio = specialCount / recent.length;
    
    // Determinar padrão baseado na proporção de especiais
    if (specialRatio === 0) {
        STATE.pattern = "Drenagem Básica";
    } else if (specialRatio <= 0.1) {
        STATE.pattern = "Drenagem Prolongada";
    } else if (specialRatio <= 0.2) {
        STATE.pattern = "Manipulação Reativa";
    } else if (specialRatio <= 0.3) {
        STATE.pattern = "Entrega Calculada";
    } else {
        STATE.pattern = "Entrega Emocional";
    }
    
    // Calcular intensidade do padrão
    const patternIntensity = Math.min(100, Math.round(specialRatio * 100));
    document.getElementById('pattern-intensity').textContent = `${patternIntensity}%`;
    
    // Calcular duração do padrão (quantas rodadas seguidas no mesmo padrão)
    let patternDuration = 1;
    let lastPattern = STATE.pattern;
    
    for (let i = 20; i < STATE.results.length; i += 20) {
        const segment = STATE.results.slice(i, i + 20);
        if (segment.length < 10) break;
        
        const segSpecialCount = segment.filter(r => !["1", "2", "5", "10"].includes(r)).length;
        const segSpecialRatio = segSpecialCount / segment.length;
        
        let segPattern;
        if (segSpecialRatio === 0) {
            segPattern = "Drenagem Básica";
        } else if (segSpecialRatio <= 0.1) {
            segPattern = "Drenagem Prolongada";
        } else if (segSpecialRatio <= 0.2) {
            segPattern = "Manipulação Reativa";
        } else if (segSpecialRatio <= 0.3) {
            segPattern = "Entrega Calculada";
        } else {
            segPattern = "Entrega Emocional";
        }
        
        if (segPattern === lastPattern) {
            patternDuration++;
        } else {
            break;
        }
    }
    
    document.getElementById('pattern-duration').textContent = patternDuration;
    
    // Calcular estabilidade do padrão
    const stability = Math.min(100, Math.round((patternDuration / 5) * 100));
    document.getElementById('pattern-stability').textContent = `${stability}%`;
}

// Gerar previsões baseadas no padrão atual e vieses de aprendizado
function generatePredictions() {
    let baseProbabilities = {};
    
    // Probabilidades base de acordo com o padrão
    switch (STATE.pattern) {
        case "Drenagem Básica":
            baseProbabilities = {
                "1": 40, "2": 30, "5": 15, "10": 8,
                "C": 3, "P": 2, "H": 1.5, "CT": 0.5
            };
            break;
        case "Drenagem Prolongada":
            baseProbabilities = {
                "1": 35, "2": 30, "5": 20, "10": 8,
                "C": 3, "P": 2, "H": 1.5, "CT": 0.5
            };
            break;
        case "Manipulação Reativa":
            // Verificar se houve Crazy Time recentemente
            if (STATE.results.slice(0, 10).includes("CT")) {
                baseProbabilities = {
                    "1": 35, "2": 30, "5": 15, "10": 10,
                    "C": 5, "P": 2, "H": 2, "CT": 1
                };
            } else {
                baseProbabilities = {
                    "1": 30, "2": 25, "5": 15, "10": 10,
                    "C": 10, "P": 5, "H": 3, "CT": 2
                };
            }
            break;
        case "Entrega Calculada":
            // Verificar se houve especiais grandes recentemente
            if (STATE.results.slice(0, 5).some(r => ["CT", "P"].includes(r))) {
                baseProbabilities = {
                    "1": 30, "2": 25, "5": 15, "10": 15,
                    "C": 5, "P": 3, "H": 4, "CT": 3
                };
            } else {
                baseProbabilities = {
                    "1": 25, "2": 20, "5": 15, "10": 10,
                    "C": 10, "P": 8, "H": 7, "CT": 5
                };
            }
            break;
        case "Entrega Emocional":
            baseProbabilities = {
                "1": 20, "2": 15, "5": 15, "10": 15,
                "C": 12, "P": 10, "H": 8, "CT": 5
            };
            break;
        default:
            baseProbabilities = {
                "1": 30, "2": 25, "5": 15, "10": 10,
                "C": 8, "P": 5, "H": 4, "CT": 3
            };
    }
    
    // Ajustar com base nos vieses de aprendizado
    const adjustedProbabilities = {};
    for (const key in baseProbabilities) {
        adjustedProbabilities[key] = baseProbabilities[key] * STATE.biases[key];
    }
    
    // Normalizar para que a soma seja 100%
    const sum = Object.values(adjustedProbabilities).reduce((a, b) => a + b, 0);
    for (const key in adjustedProbabilities) {
        adjustedProbabilities[key] = (adjustedProbabilities[key] / sum) * 100;
    }
    
    // Ajustar com base em análise temporal
    adjustProbabilitiesWithTemporalPatterns(adjustedProbabilities);
    
    // Garantir que nenhuma probabilidade seja 100% (máximo CONFIG.maxConfidence)
    for (const key in adjustedProbabilities) {
        if (adjustedProbabilities[key] > CONFIG.maxConfidence) {
            adjustedProbabilities[key] = CONFIG.maxConfidence;
        }
    }
    
    // Armazenar todas as probabilidades
    STATE.allProbabilities = {...adjustedProbabilities};
    
    // Ordenar resultados por probabilidade (decrescente)
    const sortedResults = Object.entries(adjustedProbabilities)
        .sort((a, b) => b[1] - a[1])
        .map(entry => entry[0]);
    
    // Armazenar previsão para avaliação futura (apenas os 3 primeiros)
    STATE.learning.lastPrediction = sortedResults.slice(0, 3);
    
    // Armazenar previsões no estado
    STATE.predictions = sortedResults.slice(0, 3);
    
    // Atualizar confiança dos especiais
    updateSpecialConfidence();
}

// Ajustar probabilidades com base em padrões temporais
function adjustProbabilitiesWithTemporalPatterns(probabilities) {
    const now = new Date();
    const hour = now.getHours();
    const day = now.getDay();
    
    // Obter dados temporais
    const hourData = STATE.temporalPatterns.hourly[hour];
    const dayData = STATE.temporalPatterns.daily[day];
    
    if (hourData && hourData.total > 10) {
        // Ajustar com base no padrão horário
        if (hourData.pattern === "Entrega") {
            // Aumentar probabilidade de especiais
            probabilities["C"] *= 1.2;
            probabilities["P"] *= 1.3;
            probabilities["H"] *= 1.2;
            probabilities["CT"] *= 1.4;
        } else if (hourData.pattern === "Drenagem") {
            // Aumentar probabilidade de números baixos
            probabilities["1"] *= 1.2;
            probabilities["2"] *= 1.2;
        }
    }
    
    if (dayData && dayData.total > 30) {
        // Ajustar com base no padrão diário
        if (dayData.pattern === "Entrega") {
            // Aumentar probabilidade de especiais
            probabilities["C"] *= 1.1;
            probabilities["P"] *= 1.2;
            probabilities["H"] *= 1.1;
            probabilities["CT"] *= 1.3;
        } else if (dayData.pattern === "Drenagem") {
            // Aumentar probabilidade de números baixos
            probabilities["1"] *= 1.1;
            probabilities["2"] *= 1.1;
        }
    }
    
    // Renormalizar após ajustes
    const sum = Object.values(probabilities).reduce((a, b) => a + b, 0);
    for (const key in probabilities) {
        probabilities[key] = (probabilities[key] / sum) * 100;
    }
}

// Atualizar confiança para especiais
function updateSpecialConfidence() {
    // Usar probabilidades calculadas para atualizar barras de confiança
    document.getElementById('ct-confidence').style.width = `${Math.round(STATE.allProbabilities["CT"] || 0)}%`;
    document.getElementById('p-confidence').style.width = `${Math.round(STATE.allProbabilities["P"] || 0)}%`;
    document.getElementById('h-confidence').style.width = `${Math.round(STATE.allProbabilities["H"] || 0)}%`;
    document.getElementById('c-confidence').style.width = `${Math.round(STATE.allProbabilities["C"] || 0)}%`;
    
    // Atualizar valores numéricos
    document.getElementById('ct-confidence-value').textContent = `${Math.round(STATE.allProbabilities["CT"] || 0)}%`;
    document.getElementById('p-confidence-value').textContent = `${Math.round(STATE.allProbabilities["P"] || 0)}%`;
    document.getElementById('h-confidence-value').textContent = `${Math.round(STATE.allProbabilities["H"] || 0)}%`;
    document.getElementById('c-confidence-value').textContent = `${Math.round(STATE.allProbabilities["C"] || 0)}%`;
    
    // Atualizar tendências
    updateTrendIndicators();
}

// Atualizar indicadores de tendência
function updateTrendIndicators() {
    if (!STATE.previousProbabilities) return;
    
    updateTrendForResult("CT");
    updateTrendForResult("P");
    updateTrendForResult("H");
    updateTrendForResult("C");
    updateTrendForResult("1");
    updateTrendForResult("2");
    updateTrendForResult("5");
    updateTrendForResult("10");
}

// Atualizar tendência para um resultado específico
function updateTrendForResult(result) {
    const current = STATE.allProbabilities[result] || 0;
    const previous = STATE.previousProbabilities[result] || 0;
    const diff = current - previous;
    
    const trendElement = document.getElementById(`${result}-trend`);
    if (!trendElement) return;
    
    if (diff > 0.5) {
        trendElement.className = "trend trend-up";
        trendElement.textContent = `↑ ${diff.toFixed(1)}%`;
    } else if (diff < -0.5) {
        trendElement.className = "trend trend-down";
        trendElement.textContent = `↓ ${Math.abs(diff).toFixed(1)}%`;
    } else {
        trendElement.className = "trend trend-neutral";
        trendElement.textContent = `→ ${Math.abs(diff).toFixed(1)}%`;
    }
}

// Atualizar padrões temporais
function updateTemporalPatterns() {
    const now = new Date();
    const hour = now.getHours();
    const day = now.getDay();
    
    // Inicializar se não existir
    if (!STATE.temporalPatterns.hourly[hour]) {
        STATE.temporalPatterns.hourly[hour] = {
            total: 0,
            specials: 0,
            pattern: "Neutro"
        };
    }
    
    if (!STATE.temporalPatterns.daily[day]) {
        STATE.temporalPatterns.daily[day] = {
            total: 0,
            specials: 0,
            pattern: "Neutro"
        };
    }
    
    // Atualizar com o resultado mais recente
    if (STATE.results.length > 0) {
        const latest = STATE.results[0];
        STATE.temporalPatterns.hourly[hour].total++;
        STATE.temporalPatterns.daily[day].total++;
        
        if (!["1", "2", "5", "10"].includes(latest)) {
            STATE.temporalPatterns.hourly[hour].specials++;
            STATE.temporalPatterns.daily[day].specials++;
        }
    }
    
    // Determinar tendência por hora
    for (const h in STATE.temporalPatterns.hourly) {
        const data = STATE.temporalPatterns.hourly[h];
        if (data.total > 10) { // Precisa de dados suficientes
            const ratio = data.specials / data.total;
            if (ratio > 0.25) {
                data.pattern = "Entrega";
            } else if (ratio < 0.15) {
                data.pattern = "Drenagem";
            } else {
                data.pattern = "Neutro";
            }
        }
    }
    
    // Determinar tendência por dia
    for (const d in STATE.temporalPatterns.daily) {
        const data = STATE.temporalPatterns.daily[d];
        if (data.total > 30) { // Precisa de dados suficientes
            const ratio = data.specials / data.total;
            if (ratio > 0.25) {
                data.pattern = "Entrega";
            } else if (ratio < 0.15) {
                data.pattern = "Drenagem";
            } else {
                data.pattern = "Neutro";
            }
        }
    }
    
    // Atualizar UI com tendências temporais
    updateTemporalUI();
}

// Atualizar UI com tendências temporais
function updateTemporalUI() {
    const now = new Date();
    const hour = now.getHours();
    const day = now.getDay();
    
    // Dados da hora atual
    const hourData = STATE.temporalPatterns.hourly[hour] || { pattern: "Neutro", total: 0 };
    document.getElementById('time-trend').textContent = hourData.pattern;
    
    // Confiança baseada na quantidade de dados
    const hourConfidence = Math.min(100, Math.round((hourData.total / 20) * 100));
    document.getElementById('time-confidence').textContent = `${hourConfidence}%`;
    
    // Dados do dia atual
    const dayData = STATE.temporalPatterns.daily[day] || { pattern: "Neutro", total: 0 };
    document.getElementById('day-trend').textContent = dayData.pattern;
    
    // Confiança baseada na quantidade de dados
    const dayConfidence = Math.min(100, Math.round((dayData.total / 50) * 100));
    document.getElementById('day-confidence').textContent = `${dayConfidence}%`;
}

// Atualizar hora e dia atuais
function updateCurrentTimeAndDay() {
    const now = new Date();
    const timeElement = document.getElementById('current-time');
    const dayElement = document.getElementById('current-day');
    
    if (timeElement) {
        timeElement.textContent = now.toLocaleTimeString();
    }
    
    if (dayElement) {
        const days = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
        dayElement.textContent = days[now.getDay()];
    }
}

// --- FUNÇÕES DE ATUALIZAÇÃO DA UI ---

// Atualizar toda a interface
function updateUI() {
    updateResultsHistory();
    updatePredictions();
    updateStatistics();
    updateLearningStats();
    updateAllProbabilities();
}

// Atualizar histórico de resultados
function updateResultsHistory() {
    const historyContainer = document.getElementById('results-history');
    if (!historyContainer) return;
    
    historyContainer.innerHTML = '';
    
    // Mostrar até 50 resultados mais recentes
    const recentResults = STATE.results.slice(0, 50);
    
    recentResults.forEach(result => {
        const resultBall = document.createElement('div');
        resultBall.className = `result-ball ball-${result}`;
        resultBall.textContent = result;
        historyContainer.appendChild(resultBall);
    });
}

// Atualizar previsões
function updatePredictions() {
    const predictionsContainer = document.getElementById('predictions');
    if (!predictionsContainer) return;
    
    predictionsContainer.innerHTML = '';
    
    // Mostrar as 3 principais previsões
    STATE.predictions.forEach((prediction, index) => {
        const probability = STATE.allProbabilities[prediction] || 0;
        
        const predictionItem = document.createElement('div');
        predictionItem.className = 'prediction-item';
        
        predictionItem.innerHTML = `
            <div class="prediction-ball ball-${prediction}">${prediction}</div>
            <div class="prediction-text">
                <p>${getResultName(prediction)}</p>
                <div class="confidence">
                    <div class="confidence-level" style="width: ${probability}%;"></div>
                </div>
                <p class="probability-value">${probability.toFixed(2)}%</p>
            </div>
        `;
        
        predictionsContainer.appendChild(predictionItem);
    });
    
    // Atualizar padrão atual
    document.getElementById('current-pattern').textContent = STATE.pattern;
}

// Atualizar estatísticas
function updateStatistics() {
    const statsGrid = document.getElementById('stats-grid');
    if (!statsGrid) return;
    
    statsGrid.innerHTML = '';
    
    const total = STATE.results.length;
    if (total === 0) return;
    
    // Calcular estatísticas
    const stats = {
        "1": { count: STATE.stats["1"] || 0 },
        "2": { count: STATE.stats["2"] || 0 },
        "5": { count: STATE.stats["5"] || 0 },
        "10": { count: STATE.stats["10"] || 0 },
        "C": { count: STATE.stats["C"] || 0 },
        "P": { count: STATE.stats["P"] || 0 },
        "H": { count: STATE.stats["H"] || 0 },
        "CT": { count: STATE.stats["CT"] || 0 }
    };
    
    // Calcular porcentagens
    for (const key in stats) {
        stats[key].percentage = (stats[key].count / total) * 100;
    }
    
    // Adicionar estatísticas à grade
    for (const key in stats) {
        const statItem = document.createElement('div');
        statItem.className = 'stat-item';
        
        statItem.innerHTML = `
            <div class="stat-name">${getResultName(key)}</div>
            <div class="stat-value">${stats[key].count}</div>
            <div class="stat-percentage">${stats[key].percentage.toFixed(2)}%</div>
        `;
        
        statsGrid.appendChild(statItem);
    }
}

// Atualizar estatísticas de aprendizado
function updateLearningStats() {
    const correctElement = document.getElementById('correct-predictions');
    const wrongElement = document.getElementById('wrong-predictions');
    const accuracyElement = document.getElementById('accuracy-rate');
    const accuracyLevelElement = document.getElementById('accuracy-level');
    
    if (!correctElement || !wrongElement || !accuracyElement || !accuracyLevelElement) return;
    
    correctElement.textContent = STATE.learning.correct;
    wrongElement.textContent = STATE.learning.wrong;
    
    const total = STATE.learning.correct + STATE.learning.wrong;
    let accuracyRate = 0;
    
    if (total > 0) {
        accuracyRate = (STATE.learning.correct / total) * 100;
    }
    
    accuracyElement.textContent = `${accuracyRate.toFixed(2)}%`;
    accuracyLevelElement.style.width = `${accuracyRate}%`;
}

// Atualizar todas as probabilidades
function updateAllProbabilities() {
    const allProbsContainer = document.getElementById('all-probabilities');
    if (!allProbsContainer) return;
    
    allProbsContainer.innerHTML = '';
    
    // Ordenar resultados por probabilidade (decrescente)
    const sortedResults = Object.entries(STATE.allProbabilities)
        .sort((a, b) => b[1] - a[1]);
    
    sortedResults.forEach(([result, probability]) => {
        const probItem = document.createElement('div');
        probItem.className = 'probability-item';
        
        probItem.innerHTML = `
            <div class="result-indicator ball-${result}">${result}</div>
            <div class="result-name">${getResultName(result)}</div>
            <div class="probability-bar">
                <div class="probability-fill" style="width: ${probability}%;"></div>
            </div>
            <div class="probability-value">${probability.toFixed(2)}%</div>
            <div class="trend" id="${result}-trend">-</div>
        `;
        
        allProbsContainer.appendChild(probItem);
    });
}

// --- FUNÇÕES DE ATUALIZAÇÃO ONLINE ---

// Atualizar dados da API
function updateFromAPI() {
    const statusDot = document.getElementById('status-dot');
    const statusText = document.getElementById('status-text');
    
    if (statusDot && statusText) {
        statusDot.className = 'status-dot status-updating';
        statusText.textContent = 'Atualizando dados...';
    }
    
    fetch('/.netlify/functions/getResults')
    .then(response => response.json())
        .then(data => {
            if (data.success && data.results && data.results.length > 0) {
                processAPIResults(data.results);
                
                if (statusDot && statusText) {
                    statusDot.className = 'status-dot status-online';
                    statusText.textContent = 'Online - Dados Atualizados';
                }
                
                // Atualizar timestamp
                STATE.lastUpdate = new Date();
                const lastUpdateElement = document.getElementById('last-update');
                if (lastUpdateElement) {
                    lastUpdateElement.textContent = STATE.lastUpdate.toLocaleTimeString();
                }
            } else {
                throw new Error('Dados inválidos recebidos da API');
            }
        })
        .catch(error => {
            console.error('Erro ao atualizar dados:', error);
            
            if (statusDot && statusText) {
                statusDot.className = 'status-dot status-offline';
                statusText.textContent = 'Offline - Falha na atualização';
            }
        });
}

// Processar resultados da API
function processAPIResults(apiResults) {
    // Verificar se há novos resultados
    if (STATE.results.length === 0) {
        // Se não há resultados anteriores, usar todos os resultados da API
        STATE.results = [...apiResults];
        analyzeAndPredict();
        saveToLocalStorage();
        updateUI();
        return;
    }
    
    // Encontrar novos resultados (que não estão no início do STATE.results)
    let newResults = [];
    for (let i = 0; i < apiResults.length; i++) {
        // Verificar se este resultado já existe no início do STATE.results
        let exists = false;
        for (let j = 0; j < Math.min(i + 1, STATE.results.length); j++) {
            if (i + j >= apiResults.length) break;
            
            if (apiResults[i + j] !== STATE.results[j]) {
                exists = false;
                break;
            }
            exists = true;
        }
        
        if (!exists) {
            newResults.push(apiResults[i]);
        } else {
            // Encontramos onde os resultados começam a coincidir
            break;
        }
    }
    
    // Adicionar novos resultados ao início do STATE.results
    if (newResults.length > 0) {
        // Adicionar em ordem reversa para manter a ordem cronológica correta
        for (let i = newResults.length - 1; i >= 0; i--) {
            addResultToState(newResults[i]);
        }
    }
}

// Iniciar atualização automática
function startAutoUpdate() {
    if (STATE.autoUpdateTimer) {
        clearInterval(STATE.autoUpdateTimer);
    }
    
    STATE.autoUpdateTimer = setInterval(() => {
        updateFromAPI();
    }, CONFIG.updateInterval * 1000);
    
    // Atualizar imediatamente
    updateFromAPI();
}

// Parar atualização automática
function stopAutoUpdate() {
    if (STATE.autoUpdateTimer) {
        clearInterval(STATE.autoUpdateTimer);
        STATE.autoUpdateTimer = null;
    }
}

// Alternar atualização automática
function toggleAutoUpdate(event) {
    if (event.target.checked) {
        startAutoUpdate();
    } else {
        stopAutoUpdate();
    }
}

// --- FUNÇÕES DE ARMAZENAMENTO ---

// Salvar dados no localStorage
function saveToLocalStorage() {
    try {
        localStorage.setItem('crazyTimeData', JSON.stringify({
            results: STATE.results,
            learning: STATE.learning,
            biases: STATE.biases,
            temporalPatterns: STATE.temporalPatterns,
            anomalies: STATE.anomalies
        }));
    } catch (error) {
        console.error('Erro ao salvar dados:', error);
    }
}

// Carregar dados do localStorage
function loadFromLocalStorage() {
    try {
        const savedData = localStorage.getItem('crazyTimeData');
        if (savedData) {
            const parsedData = JSON.parse(savedData);
            
            // Restaurar dados
            STATE.results = parsedData.results || [];
            STATE.learning = parsedData.learning || {
                correct: 0,
                wrong: 0,
                lastPrediction: null,
                firstHitRate: 0
            };
            STATE.biases = parsedData.biases || {
                "1": 1.0, "2": 1.0, "5": 1.0, "10": 1.0,
                "C": 1.0, "P": 1.0, "H": 1.0, "CT": 1.0
            };
            STATE.temporalPatterns = parsedData.temporalPatterns || {
                hourly: {},
                daily: {}
            };
            STATE.anomalies = parsedData.anomalies || {
                count: 0,
                lastDetected: null,
                level: "Baixo"
            };
            
            // Analisar dados carregados
            if (STATE.results.length > 0) {
                analyzeAndPredict();
            }
        }
    } catch (error) {
        console.error('Erro ao carregar dados:', error);
    }
}

// Limpar resultados
function clearResults() {
    if (confirm('Tem certeza que deseja limpar todos os dados? Esta ação não pode ser desfeita.')) {
        STATE.results = [];
        STATE.predictions = [];
        STATE.allProbabilities = {};
        STATE.pattern = "Desconhecido";
        STATE.stats = {};
        STATE.learning = {
            correct: 0,
            wrong: 0,
            lastPrediction: null,
            firstHitRate: 0
        };
        STATE.biases = {
            "1": 1.0, "2": 1.0, "5": 1.0, "10": 1.0,
            "C": 1.0, "P": 1.0, "H": 1.0, "CT": 1.0
        };
        STATE.temporalPatterns = {
            hourly: {},
            daily: {}
        };
        STATE.anomalies = {
            count: 0,
            lastDetected: null,
            level: "Baixo"
        };
        
        saveToLocalStorage();
        updateUI();
    }
}

// --- FUNÇÕES AUXILIARES ---

// Obter nome completo do resultado
function getResultName(result) {
    switch (result) {
        case "1": return "Número 1";
        case "2": return "Número 2";
        case "5": return "Número 5";
        case "10": return "Número 10";
        case "C": return "Coin Flip";
        case "P": return "Pachinko";
        case "H": return "Cash Hunt";
        case "CT": return "Crazy Time";
        default: return result;
    }
}

// Alternar entre abas
function showTab(tabId) {
    // Ocultar todas as abas
    document.querySelectorAll('.tab-content').forEach(tab => {
        tab.classList.remove('active');
    });
    
    // Desativar todos os botões de aba
    document.querySelectorAll('.tab').forEach(tab => {
        tab.classList.remove('active');
    });
    
    // Mostrar a aba selecionada
    document.getElementById(tabId).classList.add('active');
    
    // Ativar o botão da aba
    document.querySelector(`.tab[onclick="showTab('${tabId}')"]`).classList.add('active');
}
