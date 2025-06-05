from flask import Flask, jsonify, send_from_directory, request
import logging
import json
import time
import os
import requests
from bs4 import BeautifulSoup
import random
from datetime import datetime

# Configurar logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger("api")

# Definir o caminho para a pasta frontend
current_dir = os.path.dirname(os.path.abspath(__file__))
FRONTEND_FOLDER = os.path.join(current_dir, "frontend")

logger.info("Pasta do frontend definida como: " + FRONTEND_FOLDER)

app = Flask(__name__, static_folder=FRONTEND_FOLDER, static_url_path="")
from flask_cors import CORS
CORS(app)  # Habilitar CORS para todas as rotas

# Cache para evitar requisições excessivas
cache = {
    "results": None,
    "last_update": 0,
    "cache_duration": 60  # segundos (1 minuto)
}

# Classe para o scraper do crazy-time.cc
class CrazyTimeCCScraper:
    def __init__(self):
        self.base_url = "https://crazy-time.cc/statistics/"
        self.user_agents = [
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.1.1 Safari/605.1.15",
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:89.0) Gecko/20100101 Firefox/89.0",
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/92.0.4515.107 Safari/537.36"
        ]
        self.session = requests.Session()
        self.last_request_time = 0
        self.min_request_interval = 2  # segundos entre requisições
        
        # Mapeamento de resultados
        self.result_mapping = {
            '1': '1', 'one': '1', 'number_1': '1', 'segment_1': '1',
            '2': '2', 'two': '2', 'number_2': '2', 'segment_2': '2',
            '5': '5', 'five': '5', 'number_5': '5', 'segment_5': '5',
            '10': '10', 'ten': '10', 'number_10': '10', 'segment_10': '10',
            'cash hunt': 'H', 'cash_hunt': 'H', 'cashhunt': 'H', 'hunt': 'H', 'ch': 'H', 'h': 'H',
            'pachinko': 'P', 'pach': 'P', 'p': 'P',
            'coin flip': 'C', 'coin_flip': 'C', 'coinflip': 'C', 'flip': 'C', 'cf': 'C', 'c': 'C',
            'crazy time': 'CT', 'crazy_time': 'CT', 'crazytime': 'CT', 'ct': 'CT'
        }
    
    def _get_random_user_agent(self):
        return random.choice(self.user_agents)
    
    def _respect_rate_limit(self):
        """Garante intervalo mínimo entre requisições"""
        current_time = time.time()
        time_since_last = current_time - self.last_request_time
        
        if time_since_last < self.min_request_interval:
            sleep_time = self.min_request_interval - time_since_last
            logger.debug(f"Respeitando rate limit, aguardando {sleep_time:.2f}s")
            time.sleep(sleep_time)
        
        self.last_request_time = time.time()
    
    def _make_request(self, url):
        """Faz requisição com headers aleatórios e respeito ao rate limit"""
        self._respect_rate_limit()
        
        headers = {
            "User-Agent": self._get_random_user_agent(),
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.5",
            "Connection": "keep-alive",
            "Upgrade-Insecure-Requests": "1",
            "Cache-Control": "max-age=0",
            "Referer": "https://crazy-time.cc/"
        }
        
        try:
            response = self.session.get(url, headers=headers, timeout=15)
            if response.status_code != 200:
                logger.warning(f"Requisição falhou com status code: {response.status_code}")
                return None
            return response
        except Exception as e:
            logger.error(f"Erro ao fazer requisição: {str(e)}")
            return None
    
    def _normalize_result(self, result_text):
        """Normaliza o texto do resultado para o formato padrão"""
        if not result_text:
            return None
            
        result_text = result_text.strip().lower()
        
        # Verificar mapeamento direto
        if result_text in self.result_mapping:
            return self.result_mapping[result_text]
        
        # Verificar mapeamento parcial
        for key, value in self.result_mapping.items():
            if key in result_text:
                return value
        
        # Verificar números
        if result_text == "1" or "number 1" in result_text or "segment 1" in result_text:
            return "1"
        elif result_text == "2" or "number 2" in result_text or "segment 2" in result_text:
            return "2"
        elif result_text == "5" or "number 5" in result_text or "segment 5" in result_text:
            return "5"
        elif result_text == "10" or "number 10" in result_text or "segment 10" in result_text:
            return "10"
        
        # Verificar bônus
        if "cash hunt" in result_text:
            return "H"
        elif "pachinko" in result_text:
            return "P"
        elif "coin flip" in result_text:
            return "C"
        elif "crazy time" in result_text and not ("tracker" in result_text or "statistics" in result_text):
            return "CT"
            
        return None
    
    def scrape_results(self):
        """Extrai os resultados recentes do Crazy Time do crazy-time.cc"""
        logger.info("Iniciando scraping de resultados do Crazy Time no crazy-time.cc")
        
        response = self._make_request(self.base_url)
        if not response:
            return {"success": False, "message": "Falha ao acessar o site crazy-time.cc", "results": []}
        
        soup = BeautifulSoup(response.text, 'html.parser')
        results = []
        
        try:
            # Procurar pela tabela de resultados
            result_table = soup.find('table')
            if not result_table:
                logger.warning("Tabela de resultados não encontrada")
                return {"success": False, "message": "Tabela de resultados não encontrada", "results": []}
            
            # Encontrar todas as linhas da tabela (exceto cabeçalho)
            rows = result_table.find_all('tr')[1:]  # Pular o cabeçalho
            
            for row in rows:
                cells = row.find_all('td')
                if len(cells) >= 3:  # Garantir que temos células suficientes
                    # A coluna "Spin Result" é a que nos interessa
                    spin_result_cell = cells[2]  # Índice 2 para a terceira coluna (Spin Result)
                    
                    # Extrair o resultado do spin
                    result_text = None
                    
                    # Tentar encontrar a imagem ou texto dentro da célula
                    img = spin_result_cell.find('img')
                    if img and img.get('alt'):
                        result_text = img.get('alt')
                    else:
                        # Se não houver imagem, tentar obter o texto diretamente
                        result_text = spin_result_cell.get_text().strip()
                    
                    # Normalizar o resultado
                    if result_text:
                        normalized_result = self._normalize_result(result_text)
                        if normalized_result:
                            results.append(normalized_result)
                        else:
                            # Tentar extrair de classes ou outros atributos
                            for element in spin_result_cell.find_all():
                                classes = element.get('class', [])
                                for cls in classes:
                                    if 'spin-' in cls:
                                        result_text = cls.replace('spin-', '')
                                        normalized_result = self._normalize_result(result_text)
                                        if normalized_result:
                                            results.append(normalized_result)
                                            break
            
            # Se ainda não encontramos resultados, tentar uma abordagem mais genérica
            if not results:
                # Procurar por elementos que possam conter resultados de spin
                spin_elements = soup.select('[class*="spin-"]')
                for element in spin_elements:
                    classes = element.get('class', [])
                    for cls in classes:
                        if 'spin-' in cls:
                            result_text = cls.replace('spin-', '')
                            normalized_result = self._normalize_result(result_text)
                            if normalized_result:
                                results.append(normalized_result)
            
            # Verificar se encontramos resultados
            if not results:
                logger.warning("Nenhum resultado encontrado")
                return {"success": False, "message": "Nenhum resultado encontrado no site", "results": []}
            
            # Limitar a 100 resultados mais recentes
            results = results[:100]
            
            logger.info(f"Scraping concluído com sucesso. Encontrados {len(results)} resultados.")
            return {
                "success": True, 
                "message": f"Encontrados {len(results)} resultados", 
                "results": results,
                "timestamp": datetime.now().isoformat()
            }
            
        except Exception as e:
            logger.error(f"Erro ao processar resultados: {str(e)}")
            return {"success": False, "message": f"Erro ao processar resultados: {str(e)}", "results": []}

# --- Rotas da API ---

@app.route("/api/results", methods=["GET"])
def get_results():
    """Endpoint para obter resultados reais do crazy-time.cc"""
    current_time = time.time()
    
    # Verificar se o cache é válido
    if cache["results"] is not None and (current_time - cache["last_update"]) < cache["cache_duration"]:
        logger.info("Retornando dados do cache")
        return jsonify(cache["results"])
    
    try:
        # Buscar dados reais do crazy-time.cc
        logger.info("Buscando dados reais do crazy-time.cc")
        scraper = CrazyTimeCCScraper()
        results = scraper.scrape_results()
        
        # Se falhar, usar dados de backup
        if not results["success"] or not results["results"]:
            logger.warning("Falha ao obter dados reais, usando dados de backup")
            results = {
                "success": True,
                "message": "Usando dados de backup (falha ao obter dados reais)",
                "results": ["1", "2", "1", "5", "C", "1", "2", "10", "1", "P", "2", "1", "5", "1", "H", "2", "1", "CT", "1", "2"],
                "timestamp": datetime.now().isoformat()
            }
        
        # Atualizar cache
        cache["results"] = results
        cache["last_update"] = current_time
        
        return jsonify(results)
    except Exception as e:
        logger.error("Erro ao buscar dados: " + str(e))
        return jsonify({"error": str(e)}), 500

@app.route("/api/analyze", methods=["POST"])
def analyze_data():
    """Endpoint para analisar dados e gerar previsões"""
    try:
        data = request.json
        if not data or not isinstance(data, list):
            return jsonify({"error": "Dados inválidos. Envie uma lista de resultados."}), 400
        
        # Processamento dos dados
        logger.info("Analisando " + str(len(data)) + " resultados")
        
        # Calcular estatísticas
        total_1 = sum(1 for item in data if item == "1")
        total_2 = sum(1 for item in data if item == "2")
        total_5 = sum(1 for item in data if item == "5")
        total_10 = sum(1 for item in data if item == "10")
        total_cash = sum(1 for item in data if item == "H")
        total_pachinko = sum(1 for item in data if item == "P")
        total_coin = sum(1 for item in data if item == "C")
        total_crazy = sum(1 for item in data if item == "CT")
        
        total_results = len(data)
        
        # Calcular probabilidades para todos os resultados
        probabilities = {
            "1": round((total_1 / total_results) * 100, 2) if total_results > 0 else 0,
            "2": round((total_2 / total_results) * 100, 2) if total_results > 0 else 0,
            "5": round((total_5 / total_results) * 100, 2) if total_results > 0 else 0,
            "10": round((total_10 / total_results) * 100, 2) if total_results > 0 else 0,
            "H": round((total_cash / total_results) * 100, 2) if total_results > 0 else 0,
            "P": round((total_pachinko / total_results) * 100, 2) if total_results > 0 else 0,
            "C": round((total_coin / total_results) * 100, 2) if total_results > 0 else 0,
            "CT": round((total_crazy / total_results) * 100, 2) if total_results > 0 else 0
        }
        
        # Determinar padrão
        last_10 = data[:10] if len(data) >= 10 else data
        special_count = sum(1 for item in last_10 if item not in ["1", "2", "5", "10"])
        
        if special_count == 0:
            pattern = "Drenagem Básica"
        elif special_count <= 2:
            pattern = "Drenagem Prolongada"
        elif special_count <= 4:
            pattern = "Manipulação Reativa"
        elif special_count <= 6:
            pattern = "Entrega Calculada"
        else:
            pattern = "Entrega Emocional"
            
        # Gerar previsão baseada no padrão e histórico recente
        last_5 = data[:5] if len(data) >= 5 else data
        
        # Lógica de previsão baseada no padrão
        if pattern == "Drenagem Básica":
            prediction = ["1", "2", "1"]  # Maior probabilidade de números baixos
        elif pattern == "Drenagem Prolongada":
            prediction = ["1", "5", "2"]  # Números baixos com alguma variação
        elif pattern == "Manipulação Reativa":
            if "CT" in last_10:
                prediction = ["1", "2", "5"]  # Volta para números baixos após especial
            else:
                prediction = ["C", "10", "2"]  # Maior chance de especial menor
        elif pattern == "Entrega Calculada":
            if any(item in ["CT", "P"] for item in last_5):
                prediction = ["1", "2", "10"]  # Números comuns após especiais grandes
            else:
                prediction = ["P", "H", "5"]  # Maior chance de especiais
        else:  # Entrega Emocional
            prediction = ["CT", "P", "H"]  # Alta chance de especiais
        
        response_data = {
            "pattern": pattern,
            "prediction": prediction,
            "probabilities": probabilities,
            "stats": {
                "1": total_1,
                "2": total_2, 
                "5": total_5,
                "10": total_10,
                "Cash Hunt": total_cash,
                "Pachinko": total_pachinko,
                "Coin Flip": total_coin,
                "Crazy Time": total_crazy
            }
        }
        
        return jsonify(response_data)
    except Exception as e:
        logger.error("Erro ao analisar dados: " + str(e))
        return jsonify({"error": str(e)}), 500

# --- Rotas para servir o Frontend --- 

@app.route("/")
def serve_index():
    logger.info("Servindo index.html de " + FRONTEND_FOLDER)
    try:
        return send_from_directory(FRONTEND_FOLDER, "index.html")
    except Exception as e:
        logger.error("Erro ao servir index.html: " + str(e))
        return "Erro ao carregar a página: " + str(e), 500

@app.route("/<path:path>")
def serve_static_files(path):
    # Servir outros arquivos estáticos (como instrucoes.html, css, js se houver)
    logger.info("Tentando servir arquivo estático: " + path + " de " + FRONTEND_FOLDER)
    try:
        if os.path.exists(os.path.join(FRONTEND_FOLDER, path)):
            return send_from_directory(FRONTEND_FOLDER, path)
        else:
            # Se o arquivo não for encontrado, servir index.html para roteamento no lado do cliente (se aplicável)
            logger.warning("Arquivo estático não encontrado: " + path + ". Servindo index.html como fallback.")
            return send_from_directory(FRONTEND_FOLDER, "index.html")
    except Exception as e:
        logger.error("Erro ao servir arquivo " + path + ": " + str(e))
        return "Erro ao carregar o arquivo " + path + ": " + str(e), 500
