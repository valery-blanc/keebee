FROM php:8.2-apache

# PHP extensions required by SLiMS
RUN apt-get update && apt-get install -y --no-install-recommends \
        libpng-dev libjpeg-dev libfreetype6-dev libzip-dev libxml2-dev \
        libcurl4-openssl-dev libicu-dev libonig-dev \
        libyaz-dev yaz \
        unzip wget \
    && docker-php-ext-configure gd --with-freetype --with-jpeg \
    && docker-php-ext-install -j$(nproc) \
        mysqli pdo_mysql gd zip xml mbstring curl intl opcache gettext \
    && pecl install yaz \
    && docker-php-ext-enable yaz \
    && rm -rf /var/lib/apt/lists/*

# Enable mod_rewrite
RUN a2enmod rewrite

# Download SLiMS v9.7.2 from GitHub
RUN wget -q "https://github.com/slims/slims9_bulian/archive/refs/tags/v9.7.2.tar.gz" -O /tmp/slims.tar.gz \
    && tar -xzf /tmp/slims.tar.gz -C /var/www/html/ \
    && mv /var/www/html/slims9_bulian-9.7.2 /var/www/html/slims \
    && rm /tmp/slims.tar.gz

# Allow .htaccess overrides
RUN sed -i 's|AllowOverride None|AllowOverride All|g' /etc/apache2/apache2.conf

# Set environment to production
RUN echo '<?php $env = '"'"'production'"'"';' > /var/www/html/slims/config/env.php

# SLiMS needs write access for its data dirs
RUN chown -R www-data:www-data /var/www/html/slims

EXPOSE 80
